import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent


def _env_value(raw: str) -> str:
    """A .env value: quotes are stripped, an unquoted value ends at an inline comment."""
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


# Local keys live in backend/.env (ignored by git). Real environment variables win.
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    _read_env_file(_env_file)

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

# No CSRF middleware: the API is stateless, with no cookies or sessions.
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
]

# Render terminates TLS and forwards the scheme. Its health checks use plain HTTP,
# so there is no SSL redirect and no HSTS preload; HSTS is only sent on secure requests.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_HSTS_SECONDS = 0 if DEBUG else 31_536_000
SECURE_HSTS_PRELOAD = False
SECURE_SSL_REDIRECT = False

# Per-client request limits on the public API. The e2e suite turns them off because it plans
# many times from one address.
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
        # A Dallas to Chicago plan stores 279 cells x 50 hours = about 14,000 entries.
        # MAX_ENTRIES 100,000 holds about seven corridors in this one process.
        "OPTIONS": {"MAX_ENTRIES": 100_000},
    }
}

PROVIDER_TIMEOUT_S = 15

# With DEBUG off, Django's default handlers are silent: request errors go to ADMINS,
# who are unset. Send app logs and request errors to stdout for Render.
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
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
    },
}

DIST_DIR = REPO_DIR / "frontend" / "dist"
WHITENOISE_ROOT = str(DIST_DIR) if DIST_DIR.is_dir() else None

# Vite puts an 8-character content hash in every asset name under /assets/.
WHITENOISE_IMMUTABLE_FILE_TEST = r"^/assets/.+-[A-Za-z0-9_-]{8}\.\w+$"

# Unknown asset paths must 404, not redirect to a slash URL that serves index.html.
APPEND_SLASH = False
