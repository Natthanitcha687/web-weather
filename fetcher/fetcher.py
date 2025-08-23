import os, time, requests, sys
from datetime import datetime, timezone
from dateutil import parser
import pytz
from pymongo import MongoClient, ASCENDING, UpdateOne

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/weather")
DB_NAME   = os.getenv("DB_NAME", "weather")
LAT       = round(float(os.getenv("LAT", "13.7563")), 4)
LON       = round(float(os.getenv("LON", "100.5018")), 4)
PLACE     = os.getenv("PLACE_NAME", "Bangkok, TH")
TZ_NAME   = os.getenv("TIMEZONE", "Asia/Bangkok")
UA        = os.getenv("PROVIDER_USER_AGENT", "WeatherMicroservicesStudentProject/1.0 (contact: you@example.com)")
RUN_ONCE  = os.getenv("RUN_ONCE", "false").lower() == "true"
INTERVAL  = int(os.getenv("FETCH_INTERVAL_MINUTES", "10"))

BKK_TZ = pytz.timezone(TZ_NAME)

def iso(dt):
    return dt.astimezone(BKK_TZ).strftime("%Y-%m-%d %H:%M:%S")

def fetch():
    url = f"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={LAT}&lon={LON}"
    headers = {"User-Agent": UA, "Accept": "application/json"}
    print("[fetcher] GET", url)
    r = requests.get(url, headers=headers, timeout=20)
    print("[fetcher] status", r.status_code)
    r.raise_for_status()
    return r.json()

def symbol_to_emoji(symbol):
    s = str(symbol or "")
    return ("⛅" if "partlycloud" in s else
            "🌧️" if "rain" in s else
            "⛈️" if "thunder" in s else
            "🌫️" if "fog" in s else
            "☁️" if "cloud" in s else
            "☀️")

def run_once(db):
    data = fetch()
    ts = data.get("properties", {}).get("timeseries", [])
    if not ts: 
        print("No timeseries"); return

    readings_ops = []
    daily = {}

    for item in ts:
        t_utc = parser.isoparse(item["time"]).replace(tzinfo=timezone.utc)
        t_loc = t_utc.astimezone(BKK_TZ)

        inst = item["data"].get("instant", {}).get("details", {})
        n1   = item["data"].get("next_1_hours", {})
        n6   = item["data"].get("next_6_hours", {})

        symbol = (n1.get("summary", {}) or n6.get("summary", {})).get("symbol_code")
        precip = (n1.get("details", {}) or {}).get("precipitation_amount", 0.0)

        doc = {
            "place": PLACE, "lat": LAT, "lon": LON,
            "time_utc": t_utc, "time_local": t_loc, "tz": TZ_NAME,
            "provider": "met.no",
            "symbol_code": symbol, "symbol_emoji": symbol_to_emoji(symbol),
            "air_temperature": inst.get("air_temperature"),
            "relative_humidity": inst.get("relative_humidity"),
            "pressure_hpa": inst.get("air_pressure_at_sea_level"),
            "wind_speed_ms": inst.get("wind_speed"),
            "wind_from_deg": inst.get("wind_from_direction"),
            "precip_mm": precip
        }
        readings_ops.append(UpdateOne(
            {"time_local": t_loc, "place": PLACE},
            {"$set": doc}, upsert=True))

        dd = t_loc.date().isoformat()
        d = daily.setdefault(dd, {"date": dd, "place": PLACE, "tz": TZ_NAME,
                                  "tmin":  10**9, "tmax": -10**9, "precip_mm": 0.0})
        if doc["air_temperature"] is not None:
            d["tmin"] = min(d["tmin"], doc["air_temperature"])
            d["tmax"] = max(d["tmax"], doc["air_temperature"])
        d["precip_mm"] += (precip or 0.0)

    if readings_ops:
        first = min([op._filter["time_local"] for op in readings_ops])
        last  = max([op._filter["time_local"] for op in readings_ops])
        print("[fetcher] upserting", len(readings_ops), "readings | range:", first, "->", last)
        db.readings.bulk_write(readings_ops)
        db.readings.create_index([("time_local", ASCENDING)])
        db.readings.create_index([("place", ASCENDING)])

    daily_ops = []
    for _, d in daily.items():
        if d["tmin"] == 10**9: d["tmin"] = None
        if d["tmax"] == -10**9: d["tmax"] = None
        daily_ops.append(UpdateOne(
            {"date": d["date"], "place": PLACE},
            {"$set": d}, upsert=True))
    if daily_ops:
        db.daily_summary.bulk_write(daily_ops)
        db.daily_summary.create_index([("date", ASCENDING)])
        db.daily_summary.create_index([("place", ASCENDING)])

    db.meta.update_one({"place": PLACE},
                       {"$set": {"last_fetch_local": iso(datetime.now(BKK_TZ)),
                                 "provider": "met.no", "lat": LAT, "lon": LON}}, upsert=True)

    print(f"[fetcher] wrote {len(readings_ops)} readings | {len(daily_ops)} daily rows")

def main():
    client = MongoClient(MONGO_URI, tz_aware=True)
    db = client[DB_NAME]
    if RUN_ONCE:
        run_once(db); return
    while True:
        try:
          run_once(db)
        except Exception as e:
          print("fetch error:", e, file=sys.stderr)
        time.sleep(INTERVAL * 60)

if __name__ == "__main__":
    main()
