import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';

const app = express();
app.use(cors());
const PORT = 4000;
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

app.listen(PORT, ()=> console.log('API listening on :'+PORT));
