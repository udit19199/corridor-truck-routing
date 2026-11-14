import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent


def _env_value(raw: str) -> str:
    value = raw.strip()
    if value[:1] in {"'", '"'}:
        return value[1:].split(value[0], 1)[0]
    return value.split(" #", 1)[0].strip()


def _read_env_file(path: Path) -> None:
    for line in path.read_text().splitlines():
        name, sep, value = line.strip().partition("=")
        name = name.removeprefix("export ").strip()
        if not sep or not name or name.startswith("#"):
            continue
        os.environ.setdefault(name, _env_value(value))


_env_file = BASE_DIR / ".env"
if _env_file.exists():
    _read_env_file(_env_file)

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
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_HSTS_SECONDS = 0 if DEBUG else 31_536_000
SECURE_HSTS_PRELOAD = False
SECURE_SSL_REDIRECT = False

THROTTLE_ENABLED = os.environ.get("THROTTLE_ENABLED", "true").lower() in {"1", "true", "yes"}

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
        "OPTIONS": {"MAX_ENTRIES": 100_000},
    }
}

PROVIDER_TIMEOUT_S = 15

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "console": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
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
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "django.security.DisallowedHost": {"handlers": ["discard"], "propagate": False},
    },
}

DIST_DIR = REPO_DIR / "frontend" / "dist"
WHITENOISE_ROOT = str(DIST_DIR) if DIST_DIR.is_dir() else None

WHITENOISE_IMMUTABLE_FILE_TEST = r"^/assets/.+-[A-Za-z0-9_-]{8}\.\w+$"

APPEND_SLASH = False
