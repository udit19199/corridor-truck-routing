# Corridor: weather-aware truck routing

A driver enters an origin, a destination, a departure time and a load weight. The app returns up to three truck routes, checks the forecast at every checkpoint for the hour the truck will reach it, scores each checkpoint with Spotter's risk and load rules, and recommends the safest route. A 0–48 hour slider plays the forecast along the whole corridor.

Live app: https://corridor-truck-routing.onrender.com (free Render plan; if it has been idle, the first load can take up to a minute)

![Plan for Dallas to Chicago with a 45,000 lb load](docs/plan.png)

## How it works

1. **Routes.** TomTom's truck routing returns up to three routes for the truck's gross weight (cargo plus 35,000 lb for the empty truck).
2. **Checkpoints.** A checkpoint every 10, 25 or 50 miles (your pick), plus the destination. Each checkpoint's ETA comes from TomTom's travel times along the route.
3. **Weather.** Open-Meteo's hourly forecast at each checkpoint, for the hour nearest its ETA.
4. **Risk.** Wind, rain and snow each get a level from the brief's table. The load rules can raise the wind level. The checkpoint takes the worst of the three.
5. **Recommendation.** Routes are ranked by No Travel miles, then Severe miles, High miles, average risk and travel time. The reason shown says why the winner beats each other route.
6. **Heatmap.** The same rules run for every grid cell within 15 miles of any route, for each hour from 0 to 48 after the departure's whole hour. Cells are 0.25° and grow to 0.5° or 1° on long trips to stay inside the weather API's limit. The server sends all 49 hours at once, so moving the slider only repaints the map, with no request.

`DESIGN.md` is the full design: requirements, exact rules, pipeline, API contract, quotas, failure modes and the alternatives considered.

## Assumptions

The brief leaves these open. Each choice is written into `backend/trips/rules.py` and `DESIGN.md`.

- When wind, rain and snow hit different levels, the checkpoint takes the worst one.
- A value on a shared edge (0.25 in/hr rain, 1.0 in/hr snow) goes to the higher band. The top edges follow the brief's "> 1.00" and "> 3.0".
- Any No Travel mile ranks a route below every route without one.
- Each checkpoint counts for the miles halfway to its neighbours.
- Wind means the sustained 10 m speed. Gusts are shown but not scored.
- ETAs are pure driving time: they ignore the 11-hour driving limit and the 10-hour break. On a 17-hour run that means the last few hundred miles are scored with a forecast about 10 hours too early. The fix (apply the 11 h / 10 h rule by default, then let the driver enter a planned stop, later read remaining hours from an ELD) is described in `DESIGN.md` section 15.
- Heatmap hour 0 is the departure's whole hour (12:00 for a 12:30 departure), not the current time.
- Departures can be up to 12 days ahead; the forecast runs out after that.
- The form asks for cargo weight. TomTom gets cargo plus 35,000 lb for the empty truck; the risk rules use cargo alone, as the brief writes them.

## Run it locally

Needs Python 3.13+ with [uv](https://docs.astral.sh/uv/) and Node 22+.

```sh
# Backend (no keys needed in fixture mode)
cd backend
uv sync
ROUTING_PROVIDER=fixture WEATHER_PROVIDER=fixture DEBUG=true uv run python manage.py runserver 8000

# Frontend, in a second terminal
cd frontend
npm ci
npm run dev        # http://localhost:5173
```

For real routes, put `TOMTOM_API_KEY=...` in `backend/.env` (ignored by git) or your shell, and drop the two `*_PROVIDER` variables. Open-Meteo needs no key.

Fixture mode serves three recorded Dallas to Chicago routes and a scripted, moving storm. Search for "Dallas" and "Chicago". Up to 40,000 lb Route A wins; from 40,001 lb the 35 to 44 mph wind on Route A becomes Severe and Route B wins.

## Tests

End-to-end tests drive the real UI in Chromium against Django in fixture mode:

```sh
cd e2e
npm ci
npx playwright install chromium
npm test
```

They cover the recommendation, the load rule flipping it at exactly 40,001 lb, checkpoint placement and coverage, checkpoints matching the heatmap at their hour, ETA order, the slider repainting with no network request, and input validation.

## Stack

Django 5.2 (plain JSON views, no database), React 18 + TypeScript + Vite, MapLibre GL with OpenFreeMap tiles, TomTom Routing and Search, Open-Meteo. Hosted on Render as one Docker image; Django serves the built front end.

## How this was built

I own the result, good and bad. I wrote the plan and the design first (`DESIGN.md`), then built it in small pieces and reviewed each one before moving on. I decided the open questions, chose what to fix and what to leave, and checked each change with the tests and in the browser before committing it. The commit history shows the order: design, then the core, then review and fix rounds.
