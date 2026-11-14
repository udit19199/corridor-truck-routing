# One entry point for both halves of the monorepo. Each target mirrors a CI job in
# .github/workflows/ci.yml, so a local pass means the same things a green CI means.
# Run `make setup` once before `make check` or `make test`.

.PHONY: setup dev-backend dev-live dev-frontend check test

setup:
	cd backend && uv sync
	cd frontend && npm ci
	cd frontend && npx playwright install --with-deps chromium

dev-backend:
	cd backend && DEBUG=true ROUTING_PROVIDER=fixture WEATHER_PROVIDER=fixture uv run python manage.py runserver 8000

# Reads TOMTOM_API_KEY from backend/.env. Variables here would win over that file, so set none.
dev-live:
	cd backend && uv run python manage.py runserver 8000

dev-frontend:
	cd frontend && npm run dev

check:
	cd backend && uv run --frozen ruff check .
	cd backend && uv run --frozen ruff format --check .
	cd backend && uv run --frozen ty check trips config
	cd backend && uv run --frozen python manage.py check
	cd backend && ROUTING_PROVIDER=fixture WEATHER_PROVIDER=fixture uv run --frozen python check_fixture.py
	cd frontend && npm run build

test:
	cd frontend && npm run test:e2e
