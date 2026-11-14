# One entry point for both halves of the monorepo. Each target mirrors a CI job in
# .github/workflows/ci.yml, so a local pass means the same things a green CI means.
# Run `make setup` once before `make check` or `make test`.

.PHONY: setup dev-backend dev-live dev-frontend check test

setup:
	cd backend && uv sync
	cd frontend && npm ci
	cd frontend && npx playwright install --with-deps chromium

dev-backend:
	cd backend && DEBUG=true DEMO_DATA=true uv run python manage.py runserver 8000

# Runs with live providers, loading backend/.env (copy backend/.env.example first).
# Variables already set in the shell win over that file, so set none.
dev-live:
	cd backend && uv run --env-file .env python manage.py runserver 8000

dev-frontend:
	cd frontend && npm run dev

check:
	cd backend && uv run --frozen ruff check .
	cd backend && uv run --frozen ruff format --check .
	cd backend && uv run --frozen ty check trips config
	cd backend && uv run --frozen python manage.py check
	cd frontend && npm run build

test:
	cd frontend && npm run test:e2e
