// api/index.js (final)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/weather";
const DB_NAME = process.env.DB_NAME || "weather";

const app = express();
app.use(cors());
app.use(express.json());

// connect Mongo
const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db(DB_NAME);

// routes
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/meta", async (_req, res) => {
  const m = await db.collection("meta").findOne({});
  res.json(m || {});
});

app.get("/api/current", async (_req, res) => {
  const now = new Date();
  let r = await db.collection("readings")
    .find({ time_utc: { $lte: now } })
    .sort({ time_utc: -1 })
    .limit(1).toArray();
  if (!r[0]) {
    r = await db.collection("readings")
      .find({ time_utc: { $gte: now } })
      .sort({ time_utc: 1 })
      .limit(1).toArray();
    if (r[0]) r[0].forecast = true;
  }
  res.json(r[0] || {});
});

app.get("/api/readings/recent", async (req, res) => {
  const hours = Math.max(1, Math.min(168, parseInt(req.query.hours || "12")));
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3600 * 1000);

  let items = await db.collection("readings")
    .find({ time_utc: { $gte: since, $lte: now } })
    .sort({ time_utc: 1 })
    .toArray();

  if (!items.length) {
    const until = new Date(now.getTime() + hours * 3600 * 1000);
    items = await db.collection("readings")
      .find({ time_utc: { $gte: now, $lte: until } })
      .sort({ time_utc: 1 })
      .toArray();
  }
  res.json(items);
});

app.get("/api/readings/window", async (req, res) => {
  const past = Math.max(0, Math.min(168, parseInt(req.query.past || "12")));
  const future = Math.max(0, Math.min(168, parseInt(req.query.future || "6")));
  const now = new Date();
  const since = new Date(now.getTime() - past * 3600 * 1000);
  const until = new Date(now.getTime() + future * 3600 * 1000);
  const items = await db.collection("readings")
    .find({ time_utc: { $gte: since, $lte: until } })
    .sort({ time_utc: 1 })
    .toArray();
  res.json(items);
});

app.get("/api/summary/daily", async (req, res) => {

  const days = Math.max(1, Math.min(14, parseInt(req.query.days || "7")));
  const since = new Date(Date.now() - days * 86400 * 1000);
  const items = await db.collection("daily_summary")
    .find({})
    .sort({ date: 1 })
    .toArray();
  res.json(items.filter(x => new Date(x.date) >= since));
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));


// อนาคตอันใกล้ (เช่น 1–6 ชม. ข้างหน้า)
app.get("/api/readings/next", async (req, res) => {
  const hours = Math.max(1, Math.min(48, parseInt(req.query.hours || "6")));
  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600 * 1000);
  const items = await db.collection("readings")
    .find({ time_utc: { $gte: now, $lte: until } })
    .sort({ time_utc: 1 })
    .toArray();
  res.json(items);
});
