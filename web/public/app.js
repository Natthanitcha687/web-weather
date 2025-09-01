// ================== app.js (frontend) ==================
// ---- State & helpers --------------------------------------------------------
let _lastCurrent = null, _lastRecent = null, _lastDaily = null, _autotimer = null;
const CACHE_KEY = 'wx_last';

const TZ = 'Asia/Bangkok';
const fmtThai = d => new Date(d).toLocaleString('th-TH', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ
});
const timeHM = d => new Date(d).toLocaleTimeString('th-TH', {
  hour: '2-digit', minute: '2-digit', timeZone: TZ, hour12: false
});
const cToF = c => (c * 9 / 5) + 32;
let unit = localStorage.getItem('unit') || 'C';
const toUnit = v => (v == null ? null : (unit === 'C' ? v : cToF(v)));
const formatTemp = v =>
  (v == null ? `—°${unit}` : (unit === 'C' ? `${v.toFixed(1)}°C` : `${cToF(v).toFixed(1)}°F`));

function showUiError(msg) {
  const el = document.getElementById('uiError'); if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; }
  else { el.style.display = 'block'; el.textContent = msg; }
}

// ---- Theme / Sky ------------------------------------------------------------
function classifyWeather(s) {
  s = (s || '').toLowerCase();
  if (s.includes('thunder')) return 'thunder';
  if (s.includes('rain'))    return 'rain';
  if (s.includes('cloud'))   return 'cloudy';
  return 'clear';
}
function isNightLocal(d) {
  const h = parseInt(new Intl.DateTimeFormat('th-TH', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date(d)));
  return (h >= 18 || h < 6);
}
function applyTheme(kind) {
  document.body.className = document.body.className.split(' ').filter(c => !c.startsWith('wx-')).join(' ');
  document.body.classList.toggle('night', kind === 'night');
  composeSky(kind === 'night' ? 'cloudy' : 'clear', new Date());
}

function composeSky(kind, nowLocal) {
  const host = document.getElementById('wxfx'); if (!host) return;
  host.innerHTML = '';

  const orb = document.createElement('div');
  orb.className = isNightLocal(nowLocal) ? 'moon' : 'sun';
  host.appendChild(orb);

  const cloudCount = (kind === 'rain' || kind === 'cloudy') ? 10 : 6;
  for (let i = 0; i < cloudCount; i++) {
    const c = document.createElement('div');
    c.className = 'cloud';
    c.style.top = (5 + Math.random() * 30) + 'vh';
    c.style.left = (-15 + Math.random() * 60) + 'vw';
    const dur = 18 + Math.random() * 24;
    const neg = -(Math.random() * dur * 0.8);
    c.style.animationDuration = dur + 's';
    c.style.animationDelay = neg + 's';
    host.appendChild(c);
  }

  if (kind === 'rain') {
    const timer = setInterval(() => {
      const d = document.createElement('div');
      d.className = 'fxDrop';
      d.style.left = Math.random() * 100 + 'vw';
      d.style.animationDuration = (0.9 + Math.random() * 0.9) + 's';
      host.appendChild(d);
      setTimeout(() => d.remove(), 2000);
    }, 90);
    host.dataset.rainMaker = String(timer);
  } else if (host.dataset.rainMaker) {
    clearInterval(parseInt(host.dataset.rainMaker, 10));
    host.dataset.rainMaker = '';
  }
}

// ---- Clock ------------------------------------------------------------------
let _clock = null;
function renderUpdatedLine() {
  const el = document.getElementById('updatedAt'); if (!el) return;
  el.innerHTML = `<span class="live">● LIVE</span> อัปเดตล่าสุด ${fmtThai(new Date())}`;
}
function startClock() {
  if (_clock) clearInterval(_clock);
  renderUpdatedLine();
  _clock = setInterval(renderUpdatedLine, 60 * 1000);
}

// ---- Controls ---------------------------------------------------------------
function applyUnitButtons() {
  document.getElementById('unitC').classList.toggle('active', unit === 'C');
  document.getElementById('unitF').classList.toggle('active', unit === 'F');
}
function applyModeButtons() {
  const isNight = document.body.classList.contains('night');
  document.getElementById('modeLight').classList.toggle('active', !isNight);
  document.getElementById('modeNight').classList.toggle('active', isNight);
}

function initControls() {
  const btn = document.getElementById('btnRefresh');
  if (btn) btn.addEventListener('click', () => { btn.classList.add('blip'); setTimeout(() => btn.classList.remove('blip'), 500); fetchAll(); });

  const uc = document.getElementById('unitC'), uf = document.getElementById('unitF');
  if (uc) uc.addEventListener('click', () => { unit = 'C'; localStorage.setItem('unit', 'C'); applyUnitButtons(); rerender(); updateCharts(); });
  if (uf) uf.addEventListener('click', () => { unit = 'F'; localStorage.setItem('unit', 'F'); applyUnitButtons(); rerender(); updateCharts(); });

  const L = document.getElementById('modeLight'), N = document.getElementById('modeNight');
  if (L) L.addEventListener('click', () => { document.body.classList.remove('night'); applyModeButtons(); composeSky('clear', new Date()); });
  if (N) N.addEventListener('click', () => { document.body.classList.add('night'); applyModeButtons(); composeSky('cloudy', new Date()); });

  const sel = document.getElementById('autoSel');
  if (sel) {
    sel.addEventListener('change', () => {
      if (_autotimer) { clearInterval(_autotimer); _autotimer = null; }
      const s = parseInt(sel.value || '0', 10);
      if (s > 0) _autotimer = setInterval(fetchAll, s * 1000);
    });
  }
  applyUnitButtons(); applyModeButtons();
}

function rerender() {
  if (_lastCurrent) renderCurrent(_lastCurrent);
  if (_lastRecent)  renderHourly(_lastRecent);
  if (_lastDaily)   renderDaily(_lastDaily);
}

// ---- Fetch & render (exponential backoff + partial success) -----------------
async function fetchAll() {
  const HOURS_FIRST_LOAD = 6;

  // fetch พร้อม timeout
  const withTimeout = (url, ms) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal })
      .finally(() => clearTimeout(t));
  };

  // ดึงทุกเอ็นพอยต์หนึ่งรอบ ด้วย timeout ที่กำหนด
  const pullOnce = async (timeoutMs) => {
    const [metaR, curR, recR, dayR] = await Promise.allSettled([
      withTimeout(window.API_URL + '/api/meta', timeoutMs).then(r => r.json()),
      withTimeout(window.API_URL + '/api/live/current', timeoutMs).then(r => r.json()),
      withTimeout(window.API_URL + `/api/live/recent?hours=${HOURS_FIRST_LOAD}`, timeoutMs).then(r => r.json()),
      withTimeout(window.API_URL + '/api/live/daily?days=7', timeoutMs).then(r => r.json())
    ]);
    return { metaR, curR, recR, dayR };
  };

  // ลอง 3 ครั้ง: 30s → 15s → 10s (backoff)
  const attempts = [30000, 15000, 10000];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const { metaR, curR, recR, dayR } = await pullOnce(attempts[i]);

      // meta
      if (metaR.status === 'fulfilled' && metaR.value?.place) {
        document.getElementById('placeHdr').textContent  = metaR.value.place;
        document.getElementById('placeBadge').textContent = '📍 ' + metaR.value.place;
        document.getElementById('tzBadge').textContent    = '🕒 ' + metaR.value.tz;
      }

      // ส่วนที่ได้สำเร็จให้เรนเดอร์ทันที
      let anyOk = false;
      if (curR.status === 'fulfilled') { _lastCurrent = curR.value; renderCurrent(_lastCurrent); anyOk = true; }
      if (recR.status === 'fulfilled') { _lastRecent  = recR.value; renderHourly(_lastRecent);   anyOk = true; }
      if (dayR.status === 'fulfilled') { _lastDaily   = dayR.value; renderDaily(_lastDaily);     anyOk = true; }

      if (anyOk) {
        // ซ่อน error, ตั้งนาฬิกา/ท้องฟ้า, เก็บแคช, วาดกราฟ
        showUiError('');
        startClock();

        if (_lastCurrent) {
          const kind = classifyWeather((_lastCurrent.symbol_code || '') + ' ' + (_lastCurrent.symbol_emoji || ''));
          composeSky(kind.includes('rain') ? 'rain' : kind, new Date());
        }
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ current:_lastCurrent, recent:_lastRecent, daily:_lastDaily })); } catch {}
        updateCharts();

        // เติม hourly ให้ครบ 12 ชม. ภายหลัง
        setTimeout(loadMoreHours, 1200);
        return; // จบความพยายามเมื่อมีข้อมูลบางส่วนแล้ว
      }
    } catch (e) {
      console.warn('fetchAll attempt error:', e);
    }
    // backoff เล็กน้อยก่อนลองใหม่ (1s, 2s)
    if (i < attempts.length - 1) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
  }

  // ยังไม่ได้อะไรสด ๆ → ใช้แคชต่อไป
  showUiError('เชื่อมต่อช้า/หลุด • กำลังแสดงข้อมูลล่าสุดที่เคยบันทึกไว้');
}

async function loadMoreHours() {
  try {
    const r = await fetch(window.API_URL + '/api/live/recent?hours=12').then(x => x.json());
    if (Array.isArray(r) && r.length) {
      _lastRecent = r;
      renderHourly(_lastRecent);
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        cached.recent = _lastRecent;
        localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
      } catch {}
      updateCharts();
    }
  } catch (e) {
    console.warn('loadMoreHours error:', e);
  }
}

// ---- Render sections ---------------------------------------------------------
function renderCurrent(c) {
  const last = document.getElementById('lastUpdated');
  if (last) { last.textContent = ''; last.style.display = 'none'; }

  document.getElementById('emoji').textContent = c?.symbol_emoji || '⛅';
  document.getElementById('temp').textContent  = formatTemp(c?.air_temperature);
  document.getElementById('rh').textContent    = (c?.relative_humidity != null ? c.relative_humidity.toFixed(1) + '%' : '—');
  document.getElementById('wind').textContent  = (c?.wind_speed_ms != null ? c.wind_speed_ms.toFixed(1) + ' m/s' : '—');
  document.getElementById('press').textContent = (c?.pressure_hpa != null ? c.pressure_hpa.toFixed(1) + ' hPa' : '—');

  const dir = document.getElementById('windDir');
  if (dir && c?.wind_from_deg != null) { dir.style.transform = `rotate(${c.wind_from_deg}deg)`; }
}

/* อิโมจิรายชั่วโมง: กลางคืนใช้พระจันทร์ */
function isNightHour(dateLike){
  const d = new Date(dateLike);
  const hh = parseInt(new Intl.DateTimeFormat('th-TH', { hour: '2-digit', timeZone: TZ, hourCycle: 'h23' }).format(d), 10);
  return (hh >= 19 || hh < 5);
}
function pickHourlyEmoji(e, dateLike){ return isNightHour(dateLike) ? '🌙' : (e.symbol_emoji || '⛅'); }

function renderHourly(list) {
  const host = document.getElementById('hourly'); if (!host) return;
  host.innerHTML = '';

  const now = new Date();
  const items = (list || [])
    .map(e => ({ e, t: new Date(e.time_local || e.time_utc || '') }))
    .filter(x => !isNaN(x.t))
    .sort((a, b) => a.t - b.t);

  const firstFuture = items.findIndex(x => x.t >= now);
  const pivot = (firstFuture === -1) ? items.length : firstFuture;
  const start = Math.max(0, pivot - 6);
  const subset = items.slice(start, start + 12);

  let dividerIdx = subset.findIndex(x => x.t >= now);
  if (dividerIdx === -1) dividerIdx = subset.length;

  subset.forEach((row, i) => {
    if (i === dividerIdx) {
      const next = document.createElement('div');
      next.className = 'tile next';
      next.textContent = '— ถัดไป —';
      host.appendChild(next);
    }
    const e = row.e;
    const emoji = pickHourlyEmoji(e, row.t);
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `
      <div style="font-size:22px">${emoji}</div>
      <div><b>${formatTemp(e.air_temperature)}</b></div>
      <div class="muted">${timeHM(e.time_local || e.time_utc || '')}</div>
    `;
    host.appendChild(tile);
  });

  if (dividerIdx === subset.length) {
    const next = document.createElement('div');
    next.className = 'tile next';
    next.textContent = '— ถัดไป —';
    host.appendChild(next);
  }
}

function renderDaily(list) {
  const host = document.getElementById('daily'); if (!host) return;
  host.innerHTML = '';

  (list || []).forEach(d => {
    const dt = new Date(d.date + 'T00:00:00+07:00');
    const w = dt.getDay();   // 0=Sun,1=Mon,...,6=Sat
    const tile = document.createElement('div');
    tile.className = `tile day-tile w${w}`;
    const dayLabel = dt.toLocaleDateString('th-TH', { weekday: 'short', day: '2-digit', month: 'short' });
    tile.innerHTML = `
      <div class="muted day-title">${dayLabel}</div>
      <div class="day-range"><b>${formatTemp(d.tmin)} ~ ${formatTemp(d.tmax)}</b></div>
    `;
    host.appendChild(tile);
  });
}

// ---- Charts (Chart.js) ------------------------------------------------------
let _chHourly = null, _chDaily = null;

function drawHourlyChart() {
  if (!window.Chart || !_lastRecent) return;
  const el = document.getElementById('chartHourly'); if (!el) return;

  const now = new Date();
  const items = _lastRecent
    .map(e => ({ t: new Date(e.time_local || e.time_utc || ''), temp: e.air_temperature }))
    .filter(x => !isNaN(x.t))
    .sort((a,b) => a.t - b.t);

  const firstFuture = items.findIndex(x => x.t >= now);
  const pivot = (firstFuture === -1) ? items.length : firstFuture;
  const start = Math.max(0, pivot - 6);
  const subset = items.slice(start, start + 12);

  const labels = subset.map(x => timeHM(x.t));
  const temps  = subset.map(x => toUnit(x.temp));

  if (_chHourly) { _chHourly.destroy(); }
  _chHourly = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ label: `Temp (°${unit})`, data: temps, tension: 0.35, fill: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y?.toFixed(1)}°${unit}` } } },
      scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: false } }
    }
  });
}

function drawDailyChart() {
  if (!window.Chart || !_lastDaily) return;
  const el = document.getElementById('chartDaily'); if (!el) return;

  const labels = _lastDaily.map(d =>
    new Date(d.date + 'T00:00:00+07:00').toLocaleDateString('th-TH', { weekday: 'short' })
  );
  const tmin = _lastDaily.map(d => toUnit(d.tmin));
  const tmax = _lastDaily.map(d => toUnit(d.tmax));

  if (_chDaily) { _chDaily.destroy(); }
  _chDaily = new Chart(el.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: `Min (°${unit})`, data: tmin, tension: 0.35, fill: false },
        { label: `Max (°${unit})`, data: tmax, tension: 0.35, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom' } },
      scales: { y: { beginAtZero: false } }
    }
  });
}

function updateCharts() {
  drawHourlyChart();
  drawDailyChart();
}

// ---- Boot -------------------------------------------------------------------
function hydrateFromCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached) {
      _lastCurrent = cached.current || null;
      _lastRecent  = cached.recent  || null;
      _lastDaily   = cached.daily   || null;
      rerender();
      updateCharts();
      showUiError('กำลังแสดงข้อมูลล่าสุดที่เคยบันทึกไว้ • กำลังอัปเดต...');
    }
  } catch {}
}

function boot() {
  hydrateFromCache();
  initControls();
  fetchAll();
  setTimeout(fetchAll, 250); // กัน resource บางตัวมาช้า
  // อุ่นเครื่อง API ให้ตื่นเร็วขึ้น (cold start)
  fetch(window.API_URL + '/api/meta').catch(()=>{});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
