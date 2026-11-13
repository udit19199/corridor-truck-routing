from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest
from django.urls import path, re_path

from trips import views


def index(_request: HttpRequest) -> FileResponse:
    index_file = Path(settings.DIST_DIR) / "index.html"
    if not index_file.is_file():
        raise Http404
    return FileResponse(index_file.open("rb"), content_type="text/html")


urlpatterns = [
    path("api/health", views.health),
    path("api/geocode", views.geocode),
    path("api/plan", views.plan),
    re_path(r"^api(?:/.*)?$", views.api_not_found),
    # Missing assets (paths with an extension) 404, so a stale page never loads HTML as JS.
    re_path(r"^(?!api(?:/|$))(?!.*\.[A-Za-z0-9]+$).*$", index),
]
