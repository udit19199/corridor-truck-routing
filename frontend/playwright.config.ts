import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  // A plan is real CPU work in one runserver process. Locally it answers in about 1 s, but
  // on a 2-core GitHub runner with 4 workers planning at once each plan took 5 to 14 s,
  // so every wait on a plan result needs more than the 5 s default.
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // With the default 7 workers, Django's runserver reset asset connections while
  // pages loaded in parallel (3 of 6 runs failed); 4 workers passed every run. CI runners
  // have 2 cores, so 2 workers there keep the plans from queueing behind each other.
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8765", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm run build && cd ../backend && uv run python manage.py runserver 127.0.0.1:8765 --noreload",
    url: "http://127.0.0.1:8765/api/health",
    timeout: 180_000,
    reuseExistingServer: false,
    env: { ROUTING_PROVIDER: "fixture", WEATHER_PROVIDER: "fixture", DEBUG: "true", THROTTLE_ENABLED: "false" },
  },
});
