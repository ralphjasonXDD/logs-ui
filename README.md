# logs-ui

Simple Grafana-style logs explorer backed by Azure Managed Grafana’s HTTP API.

Queries go through Next.js API routes so the Grafana service-account token never hits the browser.

## Setup

```bash
cd logs-ui
cp .env.example .env.local
cp config/sources.example.json config/sources.json
# fill GRAFANA_URL, GRAFANA_TOKEN, and the cluster resource ids
npm install
npm run dev
```

`config/sources.json` is gitignored. It lists services, namespaces, pod prefixes, and which cluster each one queries. Set `SOURCES_PATH` if that file lives somewhere else.

Open [http://localhost:3000](http://localhost:3000).

## Features

- Service / environment picker (CMS, Gateway, McGrath API, etc.)
- Time range + text search
- Click a row to expand pretty JSON
- **Older logs →** pagination (cursor on oldest `TimeGenerated`)
- Optional 30s auto-refresh

## API

- `GET /api/sources` — available sources + time ranges
- `GET /api/logs?sourceId=cms-production&range=1h&search=error&limit=100&beforeMs=...`
