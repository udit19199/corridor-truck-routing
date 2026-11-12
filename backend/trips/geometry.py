from bisect import bisect_right
from math import asin, ceil, cos, radians, sin, sqrt

from trips.domain import Cell, TrackPoint

EARTH_RADIUS_MI = 3958.7613
CELL_DEG = 0.25
CORRIDOR_RADIUS_MI = 15.0


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


def cell_of(lon: float, lat: float) -> Cell:
    return (round(lon / CELL_DEG) * CELL_DEG, round(lat / CELL_DEG) * CELL_DEG)


def _cells_within(lon: float, lat: float) -> set[Cell]:
    cells = set()
    centre_lon, centre_lat = round(lon / CELL_DEG), round(lat / CELL_DEG)
    for offset_lon in range(-1, 2):
        for offset_lat in range(-1, 2):
            cell_lon = (centre_lon + offset_lon) * CELL_DEG
            cell_lat = (centre_lat + offset_lat) * CELL_DEG
            if haversine(lon, lat, cell_lon, cell_lat) <= CORRIDOR_RADIUS_MI:
                cells.add((cell_lon, cell_lat))
    return cells


def corridor_cells(tracks: list[list[TrackPoint]]) -> list[Cell]:
    """Grid cells whose centres lie within CORRIDOR_RADIUS_MI of any track."""
    cells: set[Cell] = set()
    for track in tracks:
        cells |= _cells_within(track[0][0], track[0][1])
        for start, end in zip(track, track[1:], strict=False):
            steps = max(1, ceil(haversine(start[0], start[1], end[0], end[1]) * 2))
            for step in range(steps):
                fraction = step / steps
                lon = start[0] + (end[0] - start[0]) * fraction
                lat = start[1] + (end[1] - start[1]) * fraction
                cells |= _cells_within(lon, lat)
    return sorted(cells, key=lambda cell: (cell[1], cell[0]))
