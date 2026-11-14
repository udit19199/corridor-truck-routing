FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/venv \
    PATH=/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-cache && rm -f /usr/local/bin/uv
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN useradd --no-create-home --uid 10001 app
USER app
# Exec form with an explicit exec, so gunicorn replaces the shell and gets SIGTERM as PID 1.
# One worker owns the in-memory weather cache; threads carry the I/O-bound plan work.
# No control socket: nothing uses gunicornc, and the app user has no home to put it in.
CMD ["sh", "-c", "exec gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --workers 1 --threads 8 --timeout 60 --access-logfile - --no-control-socket"]
