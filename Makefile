.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------
PY      := python
PIP     := pip
API_DIR := apps/api
WEB_DIR := apps/web

# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
.PHONY: install install-node install-py
install: install-node install-py ## Install all dependencies (Node + Python)

install-node: ## Install Node workspace dependencies
	npm install

install-py: ## Install Python backend (editable, with dev extras)
	cd $(API_DIR) && $(PIP) install -e ".[dev]"

# ---------------------------------------------------------------------------
# Lint / format
# ---------------------------------------------------------------------------
.PHONY: lint lint-py lint-node
lint: lint-py lint-node ## Lint all workspaces

lint-py: ## Lint Python
	cd $(API_DIR) && ruff check .

lint-node: ## Lint Node workspaces
	npm run lint --workspaces --if-present

# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------
.PHONY: test test-py test-node
test: test-py test-node ## Run all tests

test-py: ## Run Python tests
	cd $(API_DIR) && pytest

test-node: ## Run Node tests
	npm test --workspaces --if-present

# ---------------------------------------------------------------------------
# Dev servers
# ---------------------------------------------------------------------------
.PHONY: dev-api dev-web
dev-api: ## Run the Python API locally
	cd $(API_DIR) && uvicorn ai_media_factory.main:app --reload

dev-web: ## Run the web app locally
	npm run dev --workspace $(WEB_DIR)

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
.PHONY: clean
clean: ## Remove build/cache artifacts
	rm -rf node_modules dist build coverage
	find . -type d -name "__pycache__" -prune -exec rm -rf {} +
