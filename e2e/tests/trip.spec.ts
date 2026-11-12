import { expect, test, type Page } from "@playwright/test";

async function pickPlace(page: Page, testId: string, typed: string, label: string) {
  await page.getByTestId(testId).fill(typed);
  await page.getByTestId("place-option").filter({ hasText: label }).first().click();
}

async function planTrip(page: Page, loadLb: number) {
  await page.goto("/?debug=1");
  await pickPlace(page, "origin-input", "Dal", "Dallas, TX");
  await pickPlace(page, "destination-input", "Chi", "Chicago, IL");
  await page.getByTestId("load-input").fill(String(loadLb));
  await page.getByTestId("plan-submit").click();
  await expect(page.getByTestId("route-card")).toHaveCount(3);
}

async function recommendedId(page: Page) {
  const card = page.locator('[data-testid="route-card"][data-recommended="true"]');
  await expect(card).toHaveCount(1);
  return card.getAttribute("data-route-id");
}

async function checkpointEtas(page: Page) {
  const rows = page.getByTestId("checkpoint-row");
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-eta") ?? ""));
}

test("plans three routes and recommends exactly one, listed first", async ({ page }) => {
  await planTrip(page, 20000);
  const cards = page.getByTestId("route-card");
  await expect(cards.first()).toHaveAttribute("data-recommended", "true");
  await expect(page.locator('[data-testid="route-card"][data-recommended="false"]')).toHaveCount(2);
  await expect(page.getByTestId("recommendation-reason")).toContainText("High");
});

test("a heavier load turns 35-44 mph wind into Severe and changes the recommendation", async ({ page }) => {
  await planTrip(page, 20000);
  const lightPick = await recommendedId(page);

  await page.getByTestId("load-input").fill("45000");
  await page.getByTestId("plan-submit").click();
  await expect
    .poll(() => recommendedId(page), { message: "recommendation changes with load" })
    .not.toBe(lightPick);
  await expect(page.getByTestId("recommendation-reason")).toContainText("Severe");

  await page.locator(`[data-testid="route-card"][data-route-id="${lightPick}"]`).click();
  await expect(page.locator('[data-testid="checkpoint-row"][data-level="3"]').first()).toBeVisible();
});

test("checkpoint interval controls spacing and ETAs rise along the route", async ({ page }) => {
  await planTrip(page, 20000);
  const at25 = await checkpointEtas(page);

  await page.getByTestId("interval-10").click();
  await expect(page.getByTestId("interval-10")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await checkpointEtas(page)).length).toBeGreaterThan(at25.length);
  const at10 = await checkpointEtas(page);

  await page.getByTestId("interval-50").click();
  await expect.poll(async () => (await checkpointEtas(page)).length).toBeLessThan(at25.length);

  const times = at10.map((iso) => Date.parse(iso));
  expect(times.every((t, i) => i === 0 || t >= times[i - 1]), "ETAs never go backwards").toBe(true);
  expect(times.at(-1)! - times[0], "trip lasts more than 10 hours").toBeGreaterThan(10 * 3600_000);
});

test("heatmap slider repaints without any network request", async ({ page }) => {
  await planTrip(page, 20000);
  const apiCalls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) apiCalls.push(req.url());
  });

  const slider = page.getByTestId("hour-slider");
  await slider.fill("24");
  await expect(page.getByTestId("hour-label")).toContainText("+24 h");

  const heatPaint = () =>
    page.evaluate(() => {
      type MapProbe = { getLayer(id: string): unknown; getPaintProperty(id: string, name: string): unknown };
      const map = (window as unknown as { __map: MapProbe }).__map;
      return map.getLayer("heat-cells")
        ? JSON.stringify(map.getPaintProperty("heat-cells", "fill-color"))
        : "";
    });
  await expect.poll(heatPaint, { message: "heatmap paint reads hour 24" }).toContain('"r24"');
  expect(apiCalls, "no API calls while sliding").toEqual([]);
});

test("a departure in the past shows an error and keeps the form usable", async ({ page }) => {
  await page.goto("/");
  await pickPlace(page, "origin-input", "Dal", "Dallas, TX");
  await pickPlace(page, "destination-input", "Chi", "Chicago, IL");
  await page.getByTestId("departure-input").fill("2020-01-01T08:00");
  await page.getByTestId("plan-submit").click();
  await expect(page.getByTestId("error-banner")).toContainText(/departure/i);
  await expect(page.getByTestId("plan-submit")).toBeEnabled();
});

test("the API rejects an interval outside 10, 25 and 50", async ({ request }) => {
  const res = await request.post("/api/plan", {
    data: {
      origin: { label: "Dallas, TX", lon: -96.797, lat: 32.7767 },
      destination: { label: "Chicago, IL", lon: -87.6298, lat: 41.8781 },
      departure: new Date(Date.now() + 3600_000).toISOString(),
      load_lb: 20000,
      interval_mi: 30,
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/interval/i);
});
