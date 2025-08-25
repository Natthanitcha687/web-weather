// Cache last data
let _lastCurrent = null, _lastRecent = null, _lastDaily = null, _autotimer = null;

const TZ = 'Asia/Bangkok';
const fmtThai = d =>
  new Date(d).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: TZ
  });
const timeHM = d =>
  new Date(d).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ, hour12: false
  });
const cToF = c => (c * 9 / 5) + 32;
let unit = localStorage.getItem('unit') || 'C';
const formatTemp = v =>
  (v == null ? `—°${unit}` : (unit === 'C' ? `${v.toFixed(1)}°C` : `${cToF(v).toFixed(1)}°F`));

function showUiError(msg) {
  const el = document.getElementById('uiError'); if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; }
  else { el.style.display = 'block'; el.textContent = msg; }
}

// ========= Weather classify + theme =========
function classifyWeather(s) {
  s = (s || '').toLowerCase();
  if (s.includes('thunder')) return 'thunder';
  if (s.includes('rain')) return 'rain';
  if (s.includes('cloud')) return 'cloudy';
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

// ========= SKY FX =========
function composeSky(kind, nowLocal) {
  const host = document.getElementById('wxfx'); if (!host) return;
  host.innerHTML = '';

  // Sun / Moon
  const orb = document.createElement('div');
  orb.className = isNightLocal(nowLocal) ? 'moon' : 'sun';
  host.appendChild(orb);

  // Clouds
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

  // Rain fx
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
  } else {
    if (host.dataset.rainMaker) {
      clearInterval(parseInt(host.dataset.rainMaker, 10));
      host.dataset.rainMaker = '';
    }
  }
}

// ========= Clock =========
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

// ========= Controls =========
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
  if (btn) {
    btn.addEventListener('click', () => {
      btn.classList.add('blip');
      setTimeout(() => btn.classList.remove('blip'), 500);
      fetchAll();
    });
  }

  const uc = document.getElementById('unitC'), uf = document.getElementById('unitF');
  if (uc) uc.addEventListener('click', () => { unit = 'C'; localStorage.setItem('unit', 'C'); applyUnitButtons(); rerender(); });
  if (uf) uf.addEventListener('click', () => { unit = 'F'; localStorage.setItem('unit', 'F'); applyUnitButtons(); rerender(); });

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
  if (_lastRecent) renderHourly(_lastRecent);
  if (_lastDaily) renderDaily(_lastDaily);
}

// ========= Fetch & render (ทนทานขึ้น) =========
async function fetchAll() {
  try {
    const [metaR, currentR, recentR, dailyR] = await Promise.allSettled([
      fetch(window.API_URL + '/api/meta').then(r => r.json()),
      fetch(window.API_URL + '/api/live/current').then(r => r.json()),
      fetch(window.API_URL + '/api/live/recent?hours=12').then(r => r.json()),
      fetch(window.API_URL + '/api/live/daily?days=7').then(r => r.json())
    ]);

    // meta
    if (metaR.status === 'fulfilled' && metaR.value?.place) {
      document.getElementById('placeHdr').textContent = metaR.value.place;
      document.getElementById('placeBadge').textContent = '📍 ' + metaR.value.place;
      document.getElementById('tzBadge').textContent = '🕒 ' + metaR.value.tz;
    }

    // current
    if (currentR.status === 'fulfilled') {
      _lastCurrent = currentR.value;
      renderCurrent(currentR.value);
    }

    // hourly
    if (recentR.status === 'fulfilled') {
      _lastRecent = recentR.value;
      renderHourly(recentR.value);
    } else {
      const host = document.getElementById('hourly'); if (host) host.innerHTML = '';
    }

    // daily
    if (dailyR.status === 'fulfilled') {
      _lastDaily = dailyR.value;
      renderDaily(dailyR.value);
    } else {
      const host = document.getElementById('daily'); if (host) host.innerHTML = '';
    }

    startClock();

    if (currentR.status === 'fulfilled') {
      const c = currentR.value;
      const kind = classifyWeather((c.symbol_code || '') + ' ' + (c.symbol_emoji || ''));
      composeSky(kind.includes('rain') ? 'rain' : kind, new Date());
    }

    const allFailed = [metaR, currentR, recentR, dailyR].every(r => r.status === 'rejected');
    showUiError(allFailed ? 'เชื่อมต่อ API ไม่ได้ • ตรวจสอบ service api และ API_URL' : '');

  } catch (e) {
    console.error(e);
    showUiError('เชื่อมต่อ API ไม่ได้ • ตรวจสอบ service api และ API_URL');
  }
}

function renderCurrent(c) {
  const last = document.getElementById('lastUpdated');
  if (last) { last.textContent = ''; last.style.display = 'none'; }

  document.getElementById('emoji').textContent = c.symbol_emoji || '⛅';
  document.getElementById('temp').textContent = formatTemp(c.air_temperature);
  document.getElementById('rh').textContent = (c.relative_humidity != null ? c.relative_humidity.toFixed(1) + '%' : '—');
  document.getElementById('wind').textContent = (c.wind_speed_ms != null ? c.wind_speed_ms.toFixed(1) + ' m/s' : '—');
  document.getElementById('press').textContent = (c.pressure_hpa != null ? c.pressure_hpa.toFixed(1) + ' hPa' : '—');

  const dir = document.getElementById('windDir');
  if (dir && c.wind_from_deg != null) { dir.style.transform = `rotate(${c.wind_from_deg}deg)`; }
}

/* ========= อิโมจิรายชั่วโมง: กลางคืนใช้พระจันทร์ ========= */
function isNightHour(dateLike){
  const d = new Date(dateLike);
  const hh = parseInt(new Intl.DateTimeFormat('th-TH', { hour: '2-digit', timeZone: TZ, hourCycle: 'h23' }).format(d), 10);
  return (hh >= 19 || hh < 5);
}
function pickHourlyEmoji(e, dateLike){
  if (isNightHour(dateLike)) return '🌙';
  return e.symbol_emoji || '⛅';
}

// === Hourly ===
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

  let start = Math.max(0, pivot - 6);
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
    const tile = document.createElement('div'); tile.className = 'tile';
    const dt = new Date(d.date + 'T00:00:00+07:00');
    tile.innerHTML = `
      <div class="muted">${dt.toLocaleDateString('th-TH', { weekday: 'short', day: '2-digit', month: 'short' })}</div>
      <div><b>${formatTemp(d.tmin)} ~ ${formatTemp(d.tmax)}</b></div>
    `;
    host.appendChild(tile);
  });
}

// Boot
function boot() { initControls(); fetchAll(); setTimeout(fetchAll, 250); }
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
