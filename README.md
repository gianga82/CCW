# CCW — Command Code Web

Web-UI für die Command-Code-CLI. Chat über die CLI (Go-Plan-Kompatibilität) mit Streaming, Tools-Ansicht und Session-Verlauf.

## Struktur

- `server.js` — Express-Backend: spawnt `cmd -p --output-format json --yolo`, streamt NDJSON-Events als SSE, Basic Auth
- `web/` — React-Frontend (Vite): Chat, Modellwahl, Tools-Ansicht, Sessions

## Setup

```bash
npm install --prefix /root/projekte/cc-web
npm install --prefix /root/projekte/cc-web/web
npm run build --prefix /root/projekte/cc-web/web
```

Backend (systemd-Beispiel):

```
[Service]
WorkingDirectory=/root/projekte/cc-web
Environment=CC_API_KEY=<COMMAND_CODE_API_KEY>
Environment=PORT=4100
Environment=CC_AUTH_USER=root
Environment=CC_AUTH_PASS=<passwort>
Environment=CC_WORKDIR=/root/projekte
Environment=HOME=/root
ExecStart=<node22>/bin/node /root/projekte/cc-web/server.js
```

## API

- `GET /api/models` — Modellliste (Basic Auth)
- `POST /api/chat` — `{ message, model?, sessionId? }` → SSE-Events

## Wichtig

- `HOME` muss gesetzt sein, sonst kann die CLI keine Sessions speichern (Resume schlägt fehl).
- `cmd` braucht Node ≥ 22.
