import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: true,
  // With the default 7 workers, Django's runserver reset asset connections while
  // pages loaded in parallel (3 of 6 runs failed); 4 workers passed every run.
  workers: 4,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:8765", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm --prefix ../frontend run build && cd ../backend && uv run python manage.py runserver 127.0.0.1:8765 --noreload",
    url: "http://127.0.0.1:8765/api/health",
    timeout: 180_000,
    reuseExistingServer: false,
    env: { ROUTING_PROVIDER: "fixture", WEATHER_PROVIDER: "fixture", DEBUG: "true", THROTTLE_ENABLED: "false" },
  },
});
