import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent

DEBUG = os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"}

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
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 0 if DEBUG else 31_536_000

THROTTLE_ENABLED = os.environ.get("THROTTLE_ENABLED", "true").lower() in {"1", "true", "yes"}

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {}
TIME_ZONE = "UTC"

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "trips-weather",
        "OPTIONS": {"MAX_ENTRIES": 100_000},
    },
    # Kept apart so weather writes never evict the rate limit counters.
    "throttle": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "throttle",
    },
}

PROVIDER_TIMEOUT_S = 15

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"console": {"format": "%(levelname)s %(name)s %(message)s"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "console",
            "stream": "ext://sys.stdout",
        },
        "discard": {"class": "logging.NullHandler"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.security.DisallowedHost": {"handlers": ["discard"], "propagate": False},
    },
}

DIST_DIR = REPO_DIR / "frontend" / "dist"
WHITENOISE_ROOT = str(DIST_DIR) if DIST_DIR.is_dir() else None

WHITENOISE_IMMUTABLE_FILE_TEST = r"^/assets/.+-[A-Za-z0-9_-]{8}\.\w+$"

APPEND_SLASH = False
