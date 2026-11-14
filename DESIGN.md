# Corridor: design

## 1. What it does

A driver enters an origin, a destination, a departure time and a cargo weight. The server asks TomTom for up to three truck routes, places checkpoints every 10, 25 or 50 miles, reads Open-Meteo for the hour the truck reaches each checkpoint, scores every checkpoint with the brief's risk and load rules, ranks the routes and returns one recommendation with a reason. The response also carries a heatmap for the whole corridor, hour by hour, from departure to 48 hours later.

The driver is the user: on a phone, with little time. The verdict and its reason come first; the per-checkpoint numbers are there for anyone who wants to check them. A dispatcher can use the same screen.

Out of scope for this version: accounts, saved trips and history, live re-routing while a truck is moving, and driver hours of service. The last one is the biggest accuracy gap and is covered in section 6.

## 2. Rules

`Level` is ordered: `LOW=0, MODERATE=1, HIGH=2, SEVERE=3, NO_TRAVEL=4`. The number is also the score used for average risk.

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind (mph, sustained) | < 25 | 25 to < 35 | 35 to < 45 | 45 to < 55 | ≥ 55 |
| Rain (in/hr, rain + showers) | < 0.10 | 0.10 to < 0.25 | 0.25 to < 0.50 | 0.50 to ≤ 1.00 | > 1.00 |
| Snow (in/hr, snowfall) | < 0.5 | 0.5 to < 1.0 | 1.0 to < 2.0 | 2.0 to ≤ 3.0 | > 3.0 |

A value on a shared edge goes to the higher band; 1.00 in/hr of rain and 3.0 in/hr of snow stay Severe, as the brief writes them. Values are rounded before classification, so the number on screen matches its level.

| Wind | Cargo | Level becomes |
|---|---|---|
| ≥ 55 mph | any | No Travel |
| 45 to < 55 mph | > 30,000 lb | No Travel |
| 35 to < 45 mph | > 40,000 lb | Severe |

"Over" is strict: 40,000 lb with 40 mph wind stays High, 40,001 lb is Severe.

A checkpoint takes the worst of wind, rain and snow. Its cause names the condition that set it, with ties going to wind, then snow, then rain.

Checkpoints sit at mile 0, N, 2N, ... and at the destination. Each covers the miles halfway to its neighbours, so the covered miles add up to the route. A checkpoint exactly 1 mile from the destination is kept.

Routes sort by this key, smallest first, and the first is recommended:

1. No Travel miles
2. Severe miles
3. High miles
4. Average risk = Σ(level × covered miles) / route miles, rounded to 0.01
5. Travel time

The brief starts at Severe; No Travel is worse, so it goes first. Miles are rounded to 0.1 before comparing. The sort is stable, so a full tie keeps TomTom's order.

The reason compares the winner with each other route on the first key where it wins, lists the most decisive comparison first, and states the time cost when the safer route is slower. If the winner still has Severe or No Travel miles, it says so. At 45,000 lb in the demo:

> Route B: fewer Severe miles than Route A (0 vs 75), 11 min slower; fewer High miles than Route C (150 vs 375).

## 3. Pipeline

1. TomTom truck routing, three routes, vehicle weight = cargo + 35,000 lb tare, `traffic=false` (live traffic made TomTom drop alternatives; historical speeds still shape ETAs).
2. Cumulative miles along each track; checkpoints at the chosen interval plus the destination; ETA interpolated from TomTom's travel times.
3. Weather cells within 15 miles of any track, plus any checkpoint cell. The grid is 0.25°, moved to 0.5° or 1° only when 0.25° would exceed 250 cells.
4. Open-Meteo hourly forecast for the needed hours, batched 100 cells per request, up to four requests in parallel, cached per cell and hour for 30 minutes.
5. Classify every checkpoint, summarise the route by level, rank, and write the reason.
6. Heatmap: the same classifier for every cell and each of the 49 hours.

Measured: 85 ms for the fixture plan; a live Dallas to Chicago plan takes 10.4 s cold, 7.9 s warm, most of it TomTom. With a 25 mile interval the response is 216 KB raw, 52 KB gzip. Two cold plans that overlap fetch their own cells; the cache covers repeat and nearby plans.

## 4. API

Times are ISO 8601 UTC. Coordinates are `[lon, lat]`. Errors are `{"error": "<sentence>"}`.

| Endpoint | Success | Errors |
|---|---|---|
| `GET /api/health` | `200 {"ok": true}` | none |
| `GET /api/geocode?q=dal` | `200 [{label, lon, lat}]`, up to 5, US only; `[]` under 2 characters | 429, 502 |
| `POST /api/plan` | `200 PlanResponse` | 400 validation, 413 body over 2.5 MB, 422 no route, 429 throttle, 502 provider |
| other `/api/...` | none | 404 |

Validation: body is a JSON object; places have a label and valid coordinates and are at least 1 mile apart; departure has a time zone and is between 1 hour ago and 12 days ahead; cargo is a whole number from 1 to 45,000 lb; interval is 10, 25 or 50; `demo` is a boolean when present.

```ts
type Level = 0 | 1 | 2 | 3 | 4;

interface PlanRequest {
  origin: Place; destination: Place;   // Place = { label: string; lon: number; lat: number }
  departure: string; load_lb: number; interval_mi: 10 | 25 | 50;
  demo?: boolean;                       // recorded Dallas to Chicago routes and the scripted storm
}

interface PlanResponse {
  departure: string;                    // UTC
  load_lb: number; interval_mi: 10 | 25 | 50;
  recommended_id: string; reason: string;
  routes: Route[];                      // ranking order
  heatmap: Heatmap;
}

interface Route {
  id: string; name: string; distance_mi: number; duration_s: number; arrival: string;
  track: [number, number, number][];    // [lon, lat, seconds after departure]
  checkpoints: Checkpoint[];
  summary: { miles_by_level: [number, number, number, number, number]; avg_risk: number; worst: Level };
}

interface Checkpoint {
  mile: number; lon: number; lat: number; eta: string; covers_mi: number;
  weather: { wind_mph: number; gust_mph: number; rain_in_hr: number; snow_in_hr: number };
  levels: { wind: Level; rain: Level; snow: Level };
  level: Level; cause: string;
}

interface Heatmap {
  cell_deg: number;                     // 0.25, 0.5 or 1
  start: string;                        // departure floored to the UTC hour
  cells: { lon: number; lat: number; levels: Level[] }[];   // levels[h] = start + h hours, 0..48
}
```

## 5. Decisions

- **TomTom for routes, Open-Meteo for weather.** TomTom has a real truck profile, so weight changes the route and the times. Open-Meteo takes 100 locations per request, so a corridor costs a few calls. Both have free tiers.
- **One request per plan.** The response carries all 49 heatmap hours. A slider move sets one feature state per cell and replaces a three-point truck source; it never rebuilds the GeoJSON or touches the style. With a 4x CPU throttle the p95 frame time was 32.6 ms, with no source reload.
- **No database.** A plan is computed fresh. One Gunicorn worker owns the in-memory weather and geocode cache; threads carry the I/O. Redis is the first step past one instance.
- **Adaptive cells.** Open-Meteo's 600 locations per minute is the binding limit. Cells stay at 0.25° where that fits, grow on long trips, and the plan throttles to six a minute per client.
- **Fixtures and a demo.** Recorded Dallas to Chicago routes and a scripted storm make the e2e suite repeatable without keys, and let a reviewer see the load rule change the pick on a calm day. The UI labels it as not live weather.
- **Keys and errors stay on the server.** `TOMTOM_API_KEY` never reaches the browser, logs or tracebacks. Provider failures are logged as service, status and elapsed time, then mapped to 502 with a plain sentence. Input is validated before any provider call.
- **Failure behaviour.** A replan that fails leaves the previous results with a banner. A map that cannot load leaves the routes and checkpoints in the panel. A provider that returns unreadable data is a 502, not a crash.

## 6. Limits and next

Hours of service is the biggest gap. ETAs are pure driving time, so on a 17 hour run the last few hundred miles are scored about 10 hours too early: US rules allow 11 hours of driving, then a 10 hour break. The fix is to apply that rule to the ETAs by default, then let the driver enter planned stops.

After that: times in the route's own time zone, scoring gusts for empty trailers, moving the cache to Redis, and a paid instance so the app never sleeps.
