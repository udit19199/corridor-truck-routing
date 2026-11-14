"""HTTP and JSON plumbing shared by the provider clients."""

import logging
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from time import monotonic

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

Json = object


class ProviderError(Exception):
    pass


class NoRouteError(Exception):
    def __init__(self) -> None:
        super().__init__("No truck route was found between these places.")


def as_dict(value: Json) -> dict[str, Json]:
    return value if isinstance(value, dict) else {}


def as_list(value: Json) -> list[Json]:
    return value if isinstance(value, list) else []


def as_float(value: Json) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def get_json(
    url: str,
    params: dict[str, str | int],
    service: str,
    no_route_400: Callable[[Json], bool] | None = None,
) -> Json:
    timeout = settings.PROVIDER_TIMEOUT_S
    started = monotonic()
    try:
        response = requests.get(url, params=params, timeout=timeout)
    except requests.RequestException:
        log_failure(service, None, started)
        raise ProviderError(f"{service} is unavailable right now.") from None

    status = response.status_code
    if status >= 400:
        is_route_400 = status == 400 and no_route_400 is not None
        if is_route_400:
            try:
                body = response.json()
            except ValueError:
                body = None
            if no_route_400(body):
                raise NoRouteError() from None
        log_failure(service, status, started)
        if is_route_400:
            raise ProviderError(f"{service} rejected the request.") from None
        if status == 429:
            raise ProviderError(f"{service} is busy right now. Try again in a minute.") from None
        raise ProviderError(f"{service} is unavailable right now.") from None

    try:
        return response.json()
    except ValueError:
        log_failure(service, status, started)
        raise ProviderError(f"{service} returned an unreadable response.") from None


def log_failure(service: str, status: int | None, started: float) -> None:
    logger.warning(
        "provider failure service=%s status=%s elapsed_ms=%d",
        service,
        status if status is not None else "none",
        round((monotonic() - started) * 1000),
    )


def on_hour(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def chunks[T](items: list[T], size: int) -> Iterator[list[T]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]
