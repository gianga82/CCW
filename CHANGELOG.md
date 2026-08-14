# Changelog — CCW (Command Code Web)

Alle Änderungen am Code werden hier dokumentiert (Change Log).
Format: Datum | Version | Beschreibung

## 2026-08-14 — v1.0.0 — Initialer Release

- **Neu**: Express-Backend (`server.js`) — spawnt die Command-Code-CLI headless (`cmd -p --output-format json --yolo`), streamt NDJSON-Events als SSE an das Frontend
- **Neu**: React-Frontend (`web/`) — Chat mit Streaming, Modellwahl (54 Modelle gruppiert), Tools-Ansicht (queued → running → done mit Input/Result), Gedanken-Anzeige, Session-Seitenleiste mit Fortsetzen
- **Neu**: `models.json` — Modellkatalog (54 Modelle) als statische Liste
- **Neu**: Basic Auth für alle `/api/*`-Routen und das Frontend (CC_AUTH_USER / CC_AUTH_PASS)
- **Neu**: systemd-Service `cc-web.service` (Autostart, Auto-Restart), Firewall-Port 4100/tcp
- **Fix**: `req.on('close')` tötete den CLI-Prozess sofort (Express liest POST-Body vorab) → auf `res.on('close')` umgestellt; SSE-Streaming funktioniert damit
- **Fix**: systemd setzt `HOME` nicht → CLI konnte keine Sessions speichern → `Environment=HOME=/root` ergänzt; Session-Resume (`--resume`) funktioniert
- **Fix**: Mobile Layout — Seitenleiste wird auf Geräten < 820px zum Overlay-Menü (☰-Button); `100dvh` statt `100vh` gegen iOS-Scrollproblem
- **Fix**: Nach Antwort wurde die neue Session nicht als aktiv markiert → zweite Nachricht startete neue Session statt Fortsetzen; `saveSession` setzt jetzt `active`

## Sicherheitshinweise (oberste Priorität)

- **Keine Passwörter, Tokens oder API-Keys im Code** — niemals als Default-Werte! Alle Geheimnisse nur über Env-Variablen (`CC_API_KEY`, `CC_AUTH_USER`, `CC_AUTH_PASS`).
- `server.js` verweigert den Start, wenn Env-Variablen fehlen (Fail-Safe, keine Fallbacks).
- Vor jedem Push: Geheimnis-Scan (Muster: `ghp_`, `sk-m4h`, `user_`, `2911`, IP, private keys, JWT).
- Geheime Dateien (`*.log`, `.env`, Credentials) sind per `.gitignore` ausgeschlossen.
