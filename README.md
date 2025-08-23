# Weather Micro — Final (TH, Pastel Blue)

Micro‑services:
- fetcher (Python) → MET Norway (free, no API key; requires User‑Agent) → MongoDB
- api (Node/Express) → REST
- web (Node/Express Static) → Pastel UI (no charts), auto update
- mongo (MongoDB 7)

## Quick start
```bash
# 1) (optional) edit .env to set PROVIDER_USER_AGENT, LAT/LON, etc.
# 2) run
docker compose up -d --build

# 3) force first fetch (optional)
docker compose run --rm -e RUN_ONCE=true fetcher

# UI:  http://localhost:3000
# API: http://localhost:4000/api/health
```

## Deploy free (summary)
- MongoDB Atlas (M0)
- Render.com:
  - api -> Web Service (Docker), env: MONGODB_URI, DB_NAME=weather, PORT=4000
  - web -> Web Service (Docker), env: API_URL=<api public url>
  - fetcher -> Cron job: `python fetcher.py`, env same as api + RUN_ONCE=true, schedule */10 * * * *
