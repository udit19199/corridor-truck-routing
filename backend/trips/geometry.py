from bisect import bisect_right
from math import asin, ceil, cos, hypot, radians, sin, sqrt

from trips.domain import Cell, TrackPoint

EARTH_RADIUS_MI = 3958.7613
CORRIDOR_RADIUS_MI = 15.0
MILES_PER_DEG_LAT = 69.17
MIN_TRACK_SPACING_MI = 0.2


def haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = radians(lon2 - lon1)
    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_MI * asin(sqrt(a))


def cumulative_miles(track: list[TrackPoint]) -> list[float]:
    cumulative = [0.0]
    for previous, current in zip(track, track[1:], strict=False):
        cumulative.append(
            cumulative[-1] + haversine(previous[0], previous[1], current[0], current[1])
        )
    return cumulative


def point_and_time_at(track: list[TrackPoint], cumulative: list[float], mile: float) -> TrackPoint:
    if mile <= 0:
        return track[0]
    if mile >= cumulative[-1]:
        return track[-1]

    index = bisect_right(cumulative, mile) - 1
    span = cumulative[index + 1] - cumulative[index]
    fraction = (mile - cumulative[index]) / span if span else 0.0
    start, end = track[index], track[index + 1]
    lon = start[0] + (end[0] - start[0]) * fraction
    lat = start[1] + (end[1] - start[1]) * fraction
    seconds = round(start[2] + (end[2] - start[2]) * fraction)
    return (lon, lat, seconds)


def thin_track(track: list[TrackPoint]) -> list[TrackPoint]:
    if len(track) < 2:
        return track

    cumulative = cumulative_miles(track)
    kept = [0]
    for index in range(1, len(track)):
        if cumulative[index] - cumulative[kept[-1]] >= MIN_TRACK_SPACING_MI:
            kept.append(index)
    if kept[-1] != len(track) - 1:
        if cumulative[-1] - cumulative[kept[-1]] < MIN_TRACK_SPACING_MI and len(kept) > 1:
            kept.pop()
        kept.append(len(track) - 1)
    return [track[index] for index in kept]


def cell_of(lon: float, lat: float, cell_deg: float) -> Cell:
    return (round(lon / cell_deg) * cell_deg, round(lat / cell_deg) * cell_deg)


def _corridor_radius_mi(lat: float, cell_deg: float) -> float:
    height_mi = cell_deg * MILES_PER_DEG_LAT
    width_mi = height_mi * cos(radians(lat))
    return max(CORRIDOR_RADIUS_MI, hypot(height_mi, width_mi) / 2)


def _cells_near(lon: float, lat: float, cell_deg: float) -> set[Cell]:
    radius_mi = _corridor_radius_mi(lat, cell_deg)
    centre_lon, centre_lat = round(lon / cell_deg), round(lat / cell_deg)
    span_lat = ceil(radius_mi / (cell_deg * MILES_PER_DEG_LAT))
    span_lon = ceil(radius_mi / (cell_deg * MILES_PER_DEG_LAT * cos(radians(lat))))
    cells = set()
    for offset_lon in range(-span_lon, span_lon + 1):
        for offset_lat in range(-span_lat, span_lat + 1):
            cell_lon = (centre_lon + offset_lon) * cell_deg
            cell_lat = (centre_lat + offset_lat) * cell_deg
            if haversine(lon, lat, cell_lon, cell_lat) <= radius_mi:
                cells.add((cell_lon, cell_lat))
    return cells


def corridor_cells(tracks: list[list[TrackPoint]], cell_deg: float) -> set[Cell]:
    cells: set[Cell] = set()
    for track in tracks:
        cells.update(cell_of(lon, lat, cell_deg) for lon, lat, _seconds in track)
        cells |= _cells_near(track[0][0], track[0][1], cell_deg)
        cells |= _cells_near(track[-1][0], track[-1][1], cell_deg)
        for start, end in zip(track, track[1:], strict=False):
            steps = max(1, ceil(haversine(start[0], start[1], end[0], end[1]) * 2))
            for step in range(steps):
                fraction = step / steps
                lon = start[0] + (end[0] - start[0]) * fraction
                lat = start[1] + (end[1] - start[1]) * fraction
                cells |= _cells_near(lon, lat, cell_deg)
    return cells
