import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

// ถ้ารันบน Node < 18 และยังไม่มี fetch ให้เปิดสองบรรทัดล่างนี้ (และลง node-fetch@3 ด้วย)
// import fetchPkg from 'node-fetch';
// const fetch = fetchPkg;

const app = express();

// อนุญาตเฉพาะโดเมนเว็บ static ของคุณ (เพิ่ม localhost สำหรับทดสอบ)
const allowOrigins = [
  'https://web-weather-0yis.onrender.com',
  'http://localhost:3000'
];
app.use(cors({ origin: allowOrigins }));

// ===== ENV =====
const PORT = process.env.PORT || 4000;
const MONGO_URL = process.env.MONGO_URL || ''; // <-- ว่างได้
const TZ = process.env.TIMEZONE || 'Asia/Bangkok';
const PLACE = process.env.PLACE_NAME || 'Bangkok, TH';
const LAT = process.env.LAT || '13.7563';
const LON = process.env.LON || '100.5018';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Bangkok';
const PROVIDER_UA = process.env.PROVIDER_USER_AGENT || 'WeatherMicro/1.0';

// ===== Mongo (optional) =====
let db = null;
if (MONGO_URL && MONGO_URL.startsWith('mongodb')) {
  MongoClient.connect(MONGO_URL)
    .then(c => {
      db = c.db();
      console.log('API connected to Mongo');
    })
    .catch(err => {
      console.error('Mongo error (continue without DB):', err.message);
      // ไม่ process.exit(1) เพื่อให้ live endpoints ใช้งานได้
    });
} else {
  console.log('No MONGO_URL provided, running without DB');
}

// ===== health & root =====
app.get('/', (req, res) => res.send('web-weather API is running'));
app.get('/api/health', (req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// ===== meta =====
app.get('/api/meta', (req, res) => {
  res.json({ place: PLACE, tz: TZ, now: new Date().toISOString() });
});

// ===== historical from Mongo (optional) =====
app.get('/api/current', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db not available' });
  try {
    const doc = await db.collection('readings').find().sort({ time_utc: -1 }).limit(1).toArray();
    res.json(doc[0] || { error: 'no data' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/readings/recent', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db not available' });
  const hours = parseInt(req.query.hours || '12', 10);
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  try {
    const docs = await db.collection('readings')
      .find({ time_utc: { $gte: cutoff } })
      .sort({ time_utc: 1 }).toArray();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/daily', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db not available' });
  const days = Math.min(parseInt(req.query.days || '7', 10), 10);
  try {
    const pipeline = [
      { $sort: { time_utc: 1 } },
      { $group: {
          _id: '$date_local',
          tmin: { $min: '$air_temperature' },
          tmax: { $max: '$air_temperature' },
          rain: { $sum: { $ifNull: ['$precip_mm', 0] } }
      }},
      { $sort: { _id: 1 } },
      { $limit: days },
      { $project: { _id: 0, date: '$_id', tmin: 1, tmax: 1, rain: 1 } }
    ];
    const docs = await db.collection('readings').aggregate(pipeline).toArray();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== LIVE from Open-Meteo (ไม่พึ่ง DB) =====
function toISO(d){ try { return new Date(d).toISOString(); } catch { return d; } }

async function callOpenMeteo(params) {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TIMEZONE)}&${params}`;
  const r = await fetch(url, { headers: { 'User-Agent': PROVIDER_UA } });
  if (!r.ok) throw new Error('provider ' + r.status);
  return r.json();
}

app.get('/api/live/current', async (req, res) => {
  try {
    const j = await callOpenMeteo(
      'current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,rain,weather_code'
    );
    const c = j.current ?? {};
    const precipRaw = (typeof c.precipitation === 'number') ? c.precipitation
                      : (typeof c.rain === 'number') ? c.rain
                      : null;

    const out = {
      time_utc: toISO(c.time || new Date().toISOString()),
      time_local: c.time || new Date().toISOString(),
      air_temperature: c.temperature_2m ?? null,
      relative_humidity: c.relative_humidity_2m ?? null,
      wind_speed_ms: (typeof c.wind_speed_10m === 'number') ? c.wind_speed_10m / 3.6 : null,
      wind_from_deg: c.wind_direction_10m ?? null,
      pressure_hpa: c.pressure_msl ?? null,
      precip_mm: precipRaw,
      symbol_emoji: '⛅',
      provider: 'open-meteo'
    };
    res.set('Cache-Control', 'no-store');
    res.set('X-Provider-Time', String(c.time || ''));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/live/recent', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours || '12', 10), 48);
    const past  = Math.min(parseInt(req.query.past  || '3', 10), hours);

    const j = await callOpenMeteo(
      'hourly=temperature_2m,precipitation,rain,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code&past_days=1&forecast_days=2'
    );
    const { time, temperature_2m, precipitation, rain } = j.hourly || {};
    if (!time?.length) {
      res.set('Cache-Control', 'no-store');
      return res.json([]);
    }

    const now = new Date();
    let pivot = time.findIndex(t => new Date(t) > now);
    if (pivot < 0) pivot = time.length;

    const start = Math.max(0, pivot - past);
    const end   = Math.min(time.length, start + hours);

    const rows = [];
    for (let i = start; i < end; i++) {
      rows.push({
        time_utc: toISO(time[i]),
        time_local: time[i],
        air_temperature: temperature_2m?.[i] ?? null,
        precip_mm: (typeof precipitation?.[i] === 'number') ? precipitation[i]
                   : (typeof rain?.[i] === 'number') ? rain[i] : null,
        symbol_emoji: '⛅'
      });
    }
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/live/daily', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '7', 10), 14);
    const j = await callOpenMeteo('daily=temperature_2m_max,temperature_2m_min,precipitation_sum');
    const { time, temperature_2m_min, temperature_2m_max, precipitation_sum } = j.daily;
    const out = [];
    for (let i = 0; i < Math.min(days, time.length); i++) {
      out.push({
        date: time[i],
        tmin: temperature_2m_min[i],
        tmax: temperature_2m_max[i],
        rain: (precipitation_sum && precipitation_sum[i] != null) ? precipitation_sum[i] : null
      });
    }
    res.set('Cache-Control', 'no-store');
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ฟังพอร์ตของ Render
app.listen(PORT, '0.0.0.0', () => console.log('API listening on :' + PORT));
