
LIVE patch applied:
- Added /api/live/current, /api/live/recent, /api/live/daily to api/app.js (Open-Meteo).
- Frontend now fetches /api/live/* endpoints.
- Removed old #liveBadge update if present.

Optional ENV for api service:
  LAT=13.7563
  LON=100.5018
  TIMEZONE=Asia/Bangkok
  PROVIDER_USER_AGENT="WeatherMicro/1.0 (contact: you@example.com)"
