import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent

DEBUG = os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"}

# No sessions or admin, so an unconfigured instance can still boot with a throwaway key.
SECRET_KEY = os.environ.get("SECRET_KEY") or (
    "dev-insecure-key" if DEBUG else secrets.token_urlsafe(50)
)

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
    if host.strip()
]

INSTALLED_APPS = ["trips"]

MIDDLEWARE = [
    "django.middleware.gzip.GZipMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {}
TEMPLATES = []
USE_TZ = True
TIME_ZONE = "UTC"

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "trips-weather",
        # A plan stores one entry per cell-hour (about 25k keys), well past the 300 default.
        "OPTIONS": {"MAX_ENTRIES": 100_000},
    }
}

PROVIDER_TIMEOUT_S = 15

DIST_DIR = REPO_DIR / "frontend" / "dist"
WHITENOISE_ROOT = str(DIST_DIR) if DIST_DIR.is_dir() else None

# Unknown asset paths must 404, not redirect to a slash URL that serves index.html.
APPEND_SLASH = False
