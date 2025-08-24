import os, requests, pytz
from datetime import datetime
from pymongo import MongoClient

MONGO_URL = os.getenv("MONGO_URL","mongodb://mongo:27017/weather")
PLACE = os.getenv("PLACE_NAME","Bangkok, TH")
LAT = os.getenv("LAT","13.7563")
LON = os.getenv("LON","100.5018")
TZ = os.getenv("TIMEZONE","Asia/Bangkok")
UA = os.getenv("PROVIDER_USER_AGENT","WeatherMicro/1.0 (contact: you@example.com)")
RUN_ONCE = os.getenv("RUN_ONCE","false").lower() == "true"

tz_local = pytz.timezone(TZ)

def parse_utc(s):
    s = (s or "").replace("Z","+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo:
        return dt.astimezone(pytz.utc)
    return pytz.utc.localize(dt)

def main_once():
    client = MongoClient(MONGO_URL)
    db = client.get_default_database()
    url = f"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={LAT}&lon={LON}"
    print("[fetcher] GET", url)
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    data = r.json()
    series = data["properties"]["timeseries"]
    print("[fetcher] status", r.status_code, "| items:", len(series))

    wrote = 0
    for e in series:
        t_utc = parse_utc(e["time"])
        t_local = t_utc.astimezone(tz_local)
        date_local = t_local.strftime("%Y-%m-%d")

        inst = e["data"]["instant"]["details"]
        precip = 0.0
        if "next_1_hours" in e.get("data",{}):
            precip = e["data"]["next_1_hours"].get("details",{}).get("precipitation_amount",0) or 0.0

        doc = {
            "place": PLACE,
            "lat": float(LAT),
            "lon": float(LON),
            "time_utc": t_utc.isoformat(),
            "time_local": t_local.replace(tzinfo=None).isoformat(),  # naive local iso
            "date_local": date_local,
            "tz": TZ,
            "air_temperature": inst.get("air_temperature"),
            "relative_humidity": inst.get("relative_humidity"),
            "pressure_hpa": inst.get("air_pressure_at_sea_level"),
            "wind_speed_ms": inst.get("wind_speed"),
            "wind_from_deg": inst.get("wind_from_direction"),
            "precip_mm": precip
        }
        db.readings.update_one({"time_utc": doc["time_utc"]}, {"$set": doc}, upsert=True)
        wrote += 1
    print(f"[fetcher] wrote {wrote} readings")
    client.close()

def main():
    main_once()
    if not RUN_ONCE:
        # simple sleep loop (10 min)
        import time
        while True:
            time.sleep(600)
            main_once()

if __name__ == "__main__":
    main()
