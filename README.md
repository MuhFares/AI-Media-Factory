# AI Media Factory

A Python + Node monorepo for building AI-driven media generation and processing workflows.

## Repository layout

```
AI-Media-Factory/
├── apps/
│   ├── api/          # Python backend service (FastAPI)
│   └── web/          # TypeScript frontend / Node app
├── packages/
│   └── shared/       # Shared TypeScript utilities and types
├── docs/             # Architecture and design documentation
├── .github/          # CI workflows and repo templates
└── ...               # Root tooling and config
```

## Prerequisites

- Python 3.11+
- Node.js 20+
- npm 10+ (workspaces enabled)

## Getting started

```bash
# Install Node workspace dependencies
npm install

# Set up the Python backend
cd apps/api
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# macOS / Linux:       source .venv/bin/activate
pip install -e ".[dev]"
```

Copy the environment template before running anything:

```bash
cp .env.example .env
```

## Common tasks

See the [`Makefile`](./Makefile) for the full list. Highlights:

```bash
make install     # install all deps (Node + Python)
make lint        # lint all workspaces
make test        # run all tests
make dev-api     # run the Python API locally
make dev-web     # run the web app locally
```

## Documentation

- [Architecture overview](./docs/architecture.md)
- [Contributing guide](./CONTRIBUTING.md)

## License

Released under the [MIT License](./LICENSE).
