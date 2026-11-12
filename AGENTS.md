# AGENTS.md

Weather-aware truck routing: Django API (`backend/`) plus React + MapLibre UI (`frontend/`). `DESIGN.md` is the source of truth for the risk rules, the ranking, the API contract and the module map. Read it before changing logic or the contract.

## Commands

| Task | Command |
|---|---|
| Backend dev server, no keys | `cd backend && ROUTING_PROVIDER=fixture WEATHER_PROVIDER=fixture uv run python manage.py runserver 8000` |
| Frontend dev server | `cd frontend && npm run dev` (proxies `/api` to port 8000) |
| Fixture sanity script | `cd backend && ROUTING_PROVIDER=fixture WEATHER_PROVIDER=fixture uv run python scripts/check_fixture.py` |
| Backend type check | `cd backend && uv run ty check trips config` |
| End-to-end tests | `cd e2e && npm test` (builds the frontend, starts Django in fixture mode) |

## Verification by change type

| Change | Run before calling it done |
|---|---|
| `backend/trips/rules.py`, `planner.py`, `geometry.py` | `uv run ruff check . && uv run ruff format --check . && uv run ty check trips config`, `scripts/check_fixture.py`, e2e tests |
| `backend/trips/providers.py` | ruff, ty, one live request against the real API, e2e tests |
| `frontend/src/**` | `npx tsc --noEmit && npm run build`, e2e tests, and look at the page in a browser |
| API contract | Update `DESIGN.md` section 5.3 and `frontend/src/api.ts` in the same change, then e2e tests |
| `e2e/**` | e2e tests pass twice in a row |

## Rules

- Risk thresholds and load rules live only in `backend/trips/rules.py`. The API sends levels as numbers; the front end maps them to names and colours only in `frontend/src/levels.ts`. Never copy thresholds into the front end.
- Never put an API key in code, fixtures, logs or the browser bundle. Keys come from env vars; `backend/.env` is ignored by git.
- Never commit local notes or working files.
- Never add unit tests. Coverage comes from the Playwright tests in `e2e/`, which run against fixture providers.
- The heatmap slider must not trigger a network request, rebuild the heat GeoJSON or change the style. A move sets one feature state per heat cell and replaces the three-point truck source (see DESIGN.md 5.6). Keep it that way.
- Do not run React Doctor (`react-doctor` 0.9.22) locally. Its process keeps growing after it prints results (tens of GB, even with `--no-parallel`). Check React code with `tsc` and the e2e tests.
- Fixture data in `backend/trips/fixtures/` is recorded. Re-record it with a script; do not hand-edit coordinates.
