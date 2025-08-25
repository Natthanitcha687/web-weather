import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors());

// ใช้พอร์ตจาก Environment (จำเป็นสำหรับ Render)
const PORT = process.env.PORT || 4000;

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/weather';
const TZ = process.env.TIMEZONE || 'Asia/Bangkok';
const PLACE = process.env.PLACE_NAME || 'Bangkok, TH';

let db;
MongoClient.connect(MONGO_URL).then(c=>{
  db = c.db();
  console.log('API connected to Mongo');
}).catch(err=>{
  console.error('Mongo error', err);
  process.exit(1);
});

app.get('/api/health', (req,res)=> res.json({ok:true}));

app.get('/api/meta', (req,res)=>{
  res.json({ place: PLACE, tz: TZ, now: new Date().toISOString() });
});

app.get('/api/current', async (req,res)=>{
  try{
    const doc = await db.collection('readings').find().sort({time_utc:-1}).limit(1).toArray();
    res.json(doc[0] || {error:'no data'});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/readings/recent', async (req,res)=>{
  const hours = parseInt(req.query.hours||"12");
  const cutoff = new Date(Date.now() - hours*3600*1000).toISOString();
  try{
    const docs = await db.collection('readings')
      .find({ time_utc: { $gte: cutoff } })
      .sort({ time_utc: 1 }).toArray();
    res.json(docs);
  }catch(e){ res.status(500).json({error:e.message}); }
});

// Build daily summary on the fly from stored local date
app.get('/api/daily', async (req,res)=>{
  const days = Math.min(parseInt(req.query.days||'7'), 10);
  try{
    const pipeline = [
      { $sort: { time_utc: 1 } },
      { $group: {
          _id: "$date_local",
          tmin: { $min: "$air_temperature" },
          tmax: { $max: "$air_temperature" },
          rain: { $sum: { $ifNull: ["$precip_mm", 0] } }
      }},
      { $sort: { _id: 1 } },
      { $limit: days },
      { $project: { _id:0, date:"$_id", tmin:1, tmax:1, rain:1 } }
    ];
    const docs = await db.collection('readings').aggregate(pipeline).toArray();
    res.json(docs);
  }catch(e){ res.status(500).json({error:e.message}); }
});


// ===== LIVE WEATHER ENDPOINTS =====
const LAT = process.env.LAT || '13.7563';
const LON = process.env.LON || '100.5018';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Bangkok';
const PROVIDER_UA = process.env.PROVIDER_USER_AGENT || 'WeatherMicro/1.0';

function toISO(d){ try { return new Date(d).toISOString(); } catch(_) { return d; } }

async function callOpenMeteo(params){
  const base = 'https://api.open-meteo.com/v1/forecast';
  const url = `${base}?latitude=${LAT}&longitude=${LON}&timezone=${encodeURIComponent(TIMEZONE)}&${params}`;
  const r = await fetch(url, { headers: { 'User-Agent': PROVIDER_UA }});
  if (!r.ok) throw new Error('provider ' + r.status);
  return r.json();
}

// LIVE current — อิงค่าฝนตาม API ตรงๆ (ไม่ fallback/ไม่ปัดทศนิยม)
app.get('/api/live/current', async (req, res) => {
  try {
    const j = await callOpenMeteo(
      'current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,pressure_msl,precipitation,rain,weather_code'
    );
    const c = j.current ?? {};

    // ใช้ค่าจาก provider ตรงๆ: precipitation ก่อน, ไม่มีก็ rain, ถ้าไม่มีจริงๆ ให้เป็น null
    const precipRaw =
      (typeof c.precipitation === 'number') ? c.precipitation :
      (typeof c.rain === 'number') ? c.rain :
      null;

    const out = {
      time_utc: toISO(c.time || new Date().toISOString()),
      time_local: c.time || new Date().toISOString(),
      air_temperature: c.temperature_2m ?? null,
      relative_humidity: c.relative_humidity_2m ?? null,
      wind_speed_ms: (typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m / 3.6 : null), // km/h → m/s
      wind_from_deg: c.wind_direction_10m ?? null,
      pressure_hpa: c.pressure_msl ?? null,
      precip_mm: precipRaw,   // ✅ ค่าจริงจาก API (mm/h)
      symbol_emoji: '⛅',
      provider: 'open-meteo'
    };

    // ป้องกัน cache เพื่อความเรียลไทม์
    res.set('Cache-Control', 'no-store');
    res.set('X-Provider-Time', String(c.time || ''));
    res.json(out);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// LIVE recent — ยึด "ตอนนี้" เป็นแกน: ย้อนหลัง 3 ชม. + อนาคต (ค่าฝนตาม API ตรงๆ)
app.get('/api/live/recent', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours || '12', 10), 48); // รวมกี่ช่อง
    const past  = Math.min(parseInt(req.query.past  || '3', 10), hours); // ย้อนหลังกี่ช่อง

    const j = await callOpenMeteo(
      'hourly=temperature_2m,precipitation,rain,pressure_msl,wind_speed_10m,wind_direction_10m,weather_code' +
      '&past_days=1&forecast_days=2'
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
        // ✅ ส่งค่าฝนตาม API ตรงๆ (ไม่ปัด/ไม่แปลง) ถ้าไม่มีให้เป็น null
        precip_mm: (typeof precipitation?.[i] === 'number')
          ? precipitation[i]
          : (typeof rain?.[i] === 'number' ? rain[i] : null),
        symbol_emoji: '⛅'
      });
    }

    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

// LIVE daily next days (เหมือนเดิม)
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
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});
// ===== END LIVE WEATHER ENDPOINTS =====

app.listen(PORT, ()=> console.log('API listening on :' + PORT));
