import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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
  await expect(page.getByTestId("recommendation-reason")).toContainText(/^Route A: .*High miles/);
  await expect(page.getByTestId("no-safe-route")).toHaveCount(0);
});

test("a heavier load turns 35-44 mph wind into Severe and changes the recommendation", async ({ page }) => {
  await planTrip(page, 20000);
  const lightPick = await recommendedId(page);

  await page.getByTestId("load-input").fill("45000");
  await page.getByTestId("plan-submit").click();
  await expect
    .poll(() => recommendedId(page), { message: "recommendation changes with load" })
    .not.toBe(lightPick);
  await expect(page.getByTestId("recommendation-reason")).toHaveText(
    "Route B: fewer Severe miles than Route A (0 vs 75), 11 min slower; fewer High miles than Route C (175 vs 400).",
  );

  await page.locator(`[data-testid="route-card"][data-route-id="${lightPick}"]`).click();
  await expect(page.locator('[data-testid="checkpoint-row"][data-level="3"]').first()).toBeVisible();
});

test("the storm demo plans without the form and its load toggle flips the pick", async ({ page }) => {
  await page.goto("/?debug=1");
  const plans: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/plan")) plans.push(req.postData() ?? "");
  });

  await page.getByTestId("demo-start").click();
  await expect(page.getByTestId("route-card")).toHaveCount(3);
  await expect(page.getByTestId("demo-banner")).toContainText("not live weather");
  await expect(page.getByTestId("demo-load-45000")).toHaveAttribute("aria-pressed", "true");
  const heavyPick = await recommendedId(page);
  await expect(page.getByTestId("recommendation-reason")).toContainText("Route B: fewer Severe miles");

  await page.getByTestId("demo-load-20000").click();
  await expect(page.getByTestId("demo-load-20000")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => recommendedId(page)).not.toBe(heavyPick);
  expect(plans.length).toBe(2);
  expect(plans.every((body) => JSON.parse(body).demo === true)).toBe(true);

  // The form's spacing buttons belong to the form's trip, so they do not replan the demo.
  await page.getByTestId("interval-10").click();
  await page.waitForTimeout(300);
  expect(plans.length).toBe(2);
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

  // The map paints each cell from feature state; the debug build exposes the hour it last applied.
  const heatHour = () =>
    page.evaluate(() => (window as unknown as { __heatHour?: number }).__heatHour ?? -1);
  await expect.poll(heatHour, { message: "heatmap shows hour 24" }).toBe(24);
  expect(apiCalls, "no API calls while sliding").toEqual([]);
});

test("warns when every route crosses No Travel weather, and still ranks them", async ({ page }) => {
  // The demo storm never reaches No Travel, so give every route some No Travel miles.
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const plan = await response.json();
    for (const planned of plan.routes) planned.summary.miles_by_level[4] = 12.5;
    await route.fulfill({ response, json: plan });
  });
  await planTrip(page, 20000);
  await expect(page.getByTestId("no-safe-route")).toHaveText(
    "Every route crosses No Travel weather. Consider a later departure.",
  );
  await expect(page.getByTestId("route-card")).toHaveCount(3);
});

test("warns when the only route crosses Severe weather", async ({ page }) => {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const plan = await response.json();
    plan.routes = plan.routes.filter((planned: { id: string }) => planned.id === "A");
    plan.recommended_id = "A";
    plan.routes[0].summary.miles_by_level[3] = 75;
    await route.fulfill({ response, json: plan });
  });
  await page.goto("/?debug=1");
  await pickPlace(page, "origin-input", "Dal", "Dallas, TX");
  await pickPlace(page, "destination-input", "Chi", "Chicago, IL");
  await page.getByTestId("plan-submit").click();
  await expect(page.getByTestId("route-card")).toHaveCount(1);
  await expect(page.getByTestId("no-safe-route")).toHaveText(
    "The only route crosses Severe weather. Consider a later departure.",
  );
});

test("a departure in the past shows an error and keeps the form usable", async ({ page }) => {
  await page.goto("/");
  await pickPlace(page, "origin-input", "Dal", "Dallas, TX");
  await pickPlace(page, "destination-input", "Chi", "Chicago, IL");
  await page.getByTestId("departure-input").fill("2020-01-01T08:00");
  await page.getByTestId("plan-submit").click();
  await expect(page.getByTestId("departure-input-error")).toContainText(
    "Departure must be between 1 hour ago and 12 days from now.",
  );
  await expect(page.getByTestId("departure-input")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
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

test("the API rejects a demo flag that is not a boolean", async ({ request }) => {
  const res = await request.post("/api/plan", {
    data: {
      origin: { label: "Dallas, TX", lon: -96.797, lat: 32.7767 },
      destination: { label: "Chicago, IL", lon: -87.6298, lat: 41.8781 },
      departure: new Date(Date.now() + 3600_000).toISOString(),
      load_lb: 20000,
      interval_mi: 25,
      demo: "yes",
    },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toBe("demo must be true or false.");
});

type ApiCheckpoint = { mile: number; lon: number; lat: number; eta: string; covers_mi: number; level: number };
type ApiRoute = {
  id: string;
  distance_mi: number;
  checkpoints: ApiCheckpoint[];
  summary: { miles_by_level: number[] };
};
type ApiPlan = {
  recommended_id: string;
  reason: string;
  routes: ApiRoute[];
  heatmap: { cell_deg: number; start: string; cells: { lon: number; lat: number; levels: number[] }[] };
};

async function planViaApi(request: APIRequestContext, loadLb: number, intervalMi = 25): Promise<ApiPlan> {
  const departure = new Date(Date.now() + 2 * 3600_000);
  departure.setUTCMinutes(30, 0, 0); // off the hour on purpose: checkpoints and cells must still agree
  const res = await request.post("/api/plan", {
    data: {
      origin: { label: "Dallas, TX", lon: -96.797, lat: 32.7767 },
      destination: { label: "Chicago, IL", lon: -87.6298, lat: 41.8781 },
      departure: departure.toISOString(),
      load_lb: loadLb,
      interval_mi: intervalMi,
    },
  });
  expect(res.status()).toBe(200);
  return res.json();
}

const SEVERE = 3;
const HIGH = 2;

test("the load rule flips exactly above 40,000 lb", async ({ request }) => {
  const atLimit = await planViaApi(request, 40000);
  const overLimit = await planViaApi(request, 40001);
  const routeA = (plan: ApiPlan) => plan.routes.find((route) => route.id === "A")!;

  // Route A meets 35-44 mph wind: High at 40,000 lb, Severe one pound later.
  expect(atLimit.recommended_id).toBe("A");
  expect(routeA(atLimit).summary.miles_by_level[SEVERE]).toBe(0);
  expect(routeA(atLimit).summary.miles_by_level[HIGH]).toBe(75);

  expect(overLimit.recommended_id).toBe("B");
  expect(routeA(overLimit).summary.miles_by_level[SEVERE]).toBe(75);
  expect(overLimit.reason).toBe(
    "Route B: fewer Severe miles than Route A (0 vs 75), 11 min slower; fewer High miles than Route C (175 vs 400).",
  );
});

test("checkpoints cover each route exactly and match the heatmap at their hour", async ({ request }) => {
  const plan = await planViaApi(request, 20000, 25);
  const { cell_deg: cellDeg, start, cells } = plan.heatmap;
  const snap = (degrees: number) => (Math.round(degrees / cellDeg) * cellDeg).toFixed(4);
  const cellAt = new Map(cells.map((cell) => [`${snap(cell.lon)},${snap(cell.lat)}`, cell.levels]));

  for (const route of plan.routes) {
    const miles = route.checkpoints.map((checkpoint) => checkpoint.mile);
    const covered = route.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.covers_mi, 0);
    expect(Math.abs(covered - route.distance_mi), `route ${route.id} covered miles`).toBeLessThan(0.5);
    expect(miles[0]).toBe(0);
    expect(miles.at(-1)).toBe(route.distance_mi);
    miles.slice(1, -1).forEach((mile, index) => expect(mile).toBe((index + 1) * 25));

    for (const checkpoint of route.checkpoints) {
      const hour = Math.floor((Date.parse(checkpoint.eta) - Date.parse(start)) / 3600_000 + 0.5);
      const levels = cellAt.get(`${snap(checkpoint.lon)},${snap(checkpoint.lat)}`);
      expect(levels, `cell under route ${route.id} mile ${checkpoint.mile}`).toBeDefined();
      if (hour <= 48) {
        expect(levels![hour], `route ${route.id} mile ${checkpoint.mile} at +${hour} h`).toBe(checkpoint.level);
      }
    }
  }
});
