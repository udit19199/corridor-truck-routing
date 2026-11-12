# Design

How the app turns "Dallas to Chicago, Thursday 06:00, 45,000 lb" into three scored routes, a recommendation and a corridor heatmap.

## 1. High-level design


```
Browser (React + MapLibre)                Django API                     Outside services
--------------------------                ----------                     ----------------
type "Dall"  ── GET /api/geocode?q= ──▶   geocode()  ── TomTom Search ──▶  TomTom
submit form  ── POST /api/plan ───────▶   plan_trip()
                                            1. routes()   ── TomTom Routing (truck, 3 routes)
                                            2. checkpoints + ETAs (pure)
                                            3. corridor grid cells (pure)
                                            4. weather()  ── Open-Meteo hourly, one batch, cached
                                            5. risk + ranking (pure)
render map, cards, ◀── PlanResponse ────
heatmap, slider (no more requests)
```

- **One request per plan.** `/api/plan` returns routes, checkpoints, the recommendation and the whole 0–48 h heatmap. Moving the slider never calls the server, so it stays smooth.
- **The server owns all keys and rules.** The browser never sees the TomTom key and never computes risk.
- **No database.** Every plan is computed from live data. Django's local-memory cache holds weather by grid cell for 30 minutes so repeat plans stay under Open-Meteo's free limit (10,000 location-calls a day).
- **Fixture mode.** `ROUTING_PROVIDER=fixture` swaps TomTom for recorded routes; `WEATHER_PROVIDER=fixture` swaps Open-Meteo for a scripted, moving storm. The end-to-end tests run with both set, so they are repeatable and need no key. Defaults are `tomtom` and `openmeteo`.
- **Hosting.** One Docker image on Render. Django serves the built React files (WhiteNoise) and the API from one URL, so there is no CORS. A GitHub Actions job pings `/api/health` every 10 minutes so the free instance does not sleep.

## 2. Rules (the spec, made exact)

### Risk levels

`Level` is an ordered enum: `LOW=0, MODERATE=1, HIGH=2, SEVERE=3, NO_TRAVEL=4`. The number is also the score used for average risk.

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind (mph, sustained 10 m) | < 25 | 25 to < 35 | 35 to < 45 | 45 to < 55 | ≥ 55 |
| Rain (in/hr, rain + showers) | < 0.10 | 0.10 to < 0.25 | 0.25 to < 0.50 | 0.50 to ≤ 1.00 | > 1.00 |
| Snow (in/hr, snowfall) | < 0.5 | 0.5 to < 1.0 | 1.0 to < 2.0 | 2.0 to ≤ 3.0 | > 3.0 |

The brief's ranges touch at 0.25, 0.50 and so on. A value on a shared edge goes to the higher band. The top edges follow the brief's own "> 1.00" and "> 3.0", so 1.00 in/hr rain is still Severe.

### Load rules (raise wind only, never lower)

| Wind | Load | Wind level becomes |
|---|---|---|
| ≥ 55 mph | any | No Travel (same as the table) |
| 45 to < 55 mph | > 30,000 lb | No Travel |
| 35 to < 45 mph | > 40,000 lb | Severe |

### One checkpoint

`level = max(wind_level, rain_level, snow_level)`. The `cause` field names the condition that set it (ties: wind, then snow, then rain), for example "wind 41 mph with 45,000 lb load".

### Miles per checkpoint

Checkpoints sit at mile 0, N, 2N, ... and at the destination. Each one counts for the miles halfway to its neighbours. With N = 25 on a 60-mile route: mile 0 covers 12.5, mile 25 covers 25, mile 50 covers 17.5, mile 60 covers 5. The covered miles always add up to the route length.

### Ranking

Routes are sorted by this key, smallest first. The first route is recommended.

1. No Travel miles (the brief's list skips this level; any No Travel mile is worse than any Severe mile)
2. Severe miles
3. High miles
4. Average risk = Σ(level × covered miles) / route miles, rounded to 0.01 so tiny float gaps do not hide travel time
5. Travel time

Miles are rounded to 0.1 before comparing. The `reason` names, for each other route, the first key where the winner beats it, for example "Route B: fewer High miles than Route C (150 vs 350); fewer Severe miles than Route A (0 vs 50)."

## 3. Low-level design


### Modules

```
backend/
  config/           settings, urls, wsgi. Serves frontend/dist and /api/*.
  trips/
    domain.py       Level, Weather, Checkpoint, Route, RouteSummary, Plan dataclasses. No I/O.
    rules.py        THRESHOLDS table, classify(weather, load_lb), summarize(route), rank(routes).
    geometry.py     haversine, cumulative miles, point_and_time_at(track, mile), corridor_cells(tracks).
    providers.py    TomTom (geocode, routes), OpenMeteo (hourly), Fixture* twins; get_providers() picks by PROVIDER_MODE.
    planner.py      plan_trip(request, providers) -> Plan. The only place that calls providers.
    views.py        parse and validate JSON, call planner, map errors to HTTP codes.
    fixtures/       recorded routes + storm parameters for fixture mode.
frontend/src/
  api.ts            fetch wrappers and the TypeScript types below (one copy of the contract).
  App.tsx           page state: idle | loading | ready | error; selected route; slider hour.
  TripForm.tsx      place search with autocomplete, departure, load, interval picker.
  RouteMap.tsx      MapLibre map: heatmap cells, route lines, checkpoint circles, truck markers, popups.
  RouteCards.tsx    one card per route: time, distance, arrival, miles per level bar, avg risk, recommended badge + reason.
  CheckpointList.tsx checkpoints of the selected route; clicking one flies the map there and opens its popup.
  HourSlider.tsx    0–48 h slider showing "+12 h, Thu 18:00".
e2e/                Playwright tests against Django in fixture mode.
```

### API contract

All times are ISO 8601 UTC strings. Coordinates are `[lon, lat]`.

`GET /api/geocode?q=dallas` → `200 [{ "label": "Dallas, TX", "lon": -96.79, "lat": 32.77 }]` (up to 5, US only)

`POST /api/plan`

```json
{
  "origin": { "label": "Dallas, TX", "lon": -96.797, "lat": 32.777 },
  "destination": { "label": "Chicago, IL", "lon": -87.630, "lat": 41.878 },
  "departure": "2026-11-13T12:00:00Z",
  "load_lb": 45000,
  "interval_mi": 25
}
```

Validation (400 with `{ "error": "..." }`): interval in {10, 25, 50}; cargo load 1 to 45,000 lb (US legal max gross is 80,000, minus the 35,000 lb tare added for TomTom); departure from now minus 1 hour to now plus 14 days; origin and destination at least 1 mile apart. TomTom finding no route gives 422. An outside service failing gives 502 with a plain message.

Response `200`:

```ts
type Level = 0 | 1 | 2 | 3 | 4;              // LOW, MODERATE, HIGH, SEVERE, NO_TRAVEL

interface PlanResponse {
  departure: string;
  load_lb: number;
  interval_mi: 10 | 25 | 50;
  recommended_id: string;                     // "A" | "B" | "C"
  reason: string;
  routes: Route[];                            // in ranking order, recommended first
  heatmap: Heatmap;
}

interface Route {
  id: string;                                 // letter by TomTom order, stable across reranking
  name: string;                               // main roads, e.g. "I-35 N, I-44 E"
  distance_mi: number;
  duration_s: number;
  arrival: string;
  track: [number, number, number][];          // [lon, lat, seconds after departure], thinned to ≥ 0.2 mi spacing
  checkpoints: Checkpoint[];
  summary: {
    miles_by_level: [number, number, number, number, number];  // index = Level
    avg_risk: number;
    worst: Level;
  };
}

interface Checkpoint {
  mile: number;
  lon: number;
  lat: number;
  eta: string;
  covers_mi: number;
  weather: { wind_mph: number; gust_mph: number; rain_in_hr: number; snow_in_hr: number };
  levels: { wind: Level; rain: Level; snow: Level };
  level: Level;
  cause: string;
}

interface Heatmap {
  cell_deg: number;                           // 0.25
  start: string;                              // = departure; hour h is start + h hours
  cells: { lon: number; lat: number; levels: Level[] }[];  // cell centre, 49 levels for h = 0..48
}
```

### Plan pipeline (planner.py)

1. `providers.routes(origin, destination, departure, load_lb)` → up to 3 tracks. TomTom call: `travelMode=truck`, `vehicleCommercial=true`, `vehicleWeight` = (load + 35,000 lb tare) in kg, `maxAlternatives=2`, `alternativeType=anyRoute`, `departAt`, `instructionsType=coded`. Seconds at each point come from interpolating the guidance instructions' `(routeOffsetInMeters, travelTimeInSeconds)` pairs along the polyline, so slow stretches get later ETAs.
2. For each route: checkpoints at mile 0, N, 2N, ..., destination. `point_and_time_at` interpolates position and seconds; `eta = departure + seconds`.
3. Snap every checkpoint and every corridor cell to the 0.25° grid. Corridor cells are grid cells whose centre is within 15 miles of any route's track (about 280 cells for Dallas to Chicago, under Open-Meteo's 600 locations a minute). Chunks of 100 are fetched in parallel.
4. `providers.hourly(cells, start, end)`: one Open-Meteo batch (chunks of 100 locations), `start` = departure hour, `end` = max(departure + 48 h, latest arrival + 1 h). Variables `wind_speed_10m, wind_gusts_10m, rain, showers, snowfall`, `wind_speed_unit=mph`, `precipitation_unit=inch`, `timezone=GMT`. Cached per (cell, hour).
5. Each checkpoint reads its cell at the hour nearest its ETA. Each heatmap cell is classified for hours 0..48 with the same `classify` and the same load, so a checkpoint and the heatmap cell under it always show the same level at the same hour.
6. `summarize` each route, `rank`, build `reason`.

### Front end rendering

- Dark theme only, on OpenFreeMap's dark basemap with buildings, land use and minor roads removed at load.
- Map layers, bottom to top: heatmap cells (fill), route lines (non-selected grey, selected blue and thicker), checkpoint circles coloured by level, truck markers.
- The slider sets `fill-color` to read property `r{h}` from each cell. The cell GeoJSON is built once per plan with properties `r0..r48`, so a slider move is one paint-property change with no new data.
- Truck markers: position of each route's truck at departure + h hours, from `track` (binary search on seconds). Hidden once a truck has arrived.
- Level colours: Low green, Moderate yellow, High orange, Severe red, No Travel purple, lightened to read on dark. They are the same in the map, cards, list and legend.
- Times show in the browser's time zone with its abbreviation.
- The map code loads lazily, so the form appears before the 300 KB map library arrives. API responses are gzipped (plan: 268 KB raw, 59 KB sent).

## 4. Assumptions

1. ETAs use TomTom truck travel times and ignore driver rest breaks.
2. Wind means sustained wind at 10 m. Gusts are shown but not scored.
3. Weather comes from the hourly forecast hour nearest each ETA.
4. Heatmap hour 0 is the departure time, so the slider lines up with the ETAs.
5. TomTom routes for gross weight = load + 35,000 lb (a typical empty tractor-trailer). The risk rules use the load alone, as the brief states them.
6. Weather values are rounded (wind to 0.1 mph, rain and snow to 0.01 in/hr) before classifying, so the number shown always matches the level.
7. Routes are US only (the load rules are in pounds and the sample trips are US).
