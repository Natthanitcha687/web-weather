// === cache last datasets for instant re-render on unit switch ===
let _lastCurrent=null, _lastRecent=null, _lastDaily=null, _lastNext=null;

// ===== API base (fallback-safe) =====
const API = (typeof window!=='undefined' && window.API_URL) ? window.API_URL :
            `${location.protocol}//${location.hostname}:4000`;

// ===== Helpers =====
const TZ = 'Asia/Bangkok';
const fmtThai = d => new Date(d).toLocaleString('th-TH',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:TZ});
const timeHM = d => new Date(d).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',timeZone:TZ, hour12:false});
const cToF = c => (c*9/5)+32;
let unit = localStorage.getItem('unit')||'C';
const formatTemp = v => (v==null?`—°${unit}`:(unit==='C'?`${v.toFixed(1)}°C`:`${cToF(v).toFixed(1)}°F`));
function showUiError(msg){ const el=document.getElementById('uiError'); if(!el) return; if(!msg){el.style.display='none'; el.textContent='';} else {el.style.display='block'; el.textContent=msg;} }

// === theme / sky (safe) ===
function classifyWeather(s){ s=(s||'').toLowerCase(); if(s.includes('thunder'))return'thunder'; if(s.includes('rain'))return'rain'; if(s.includes('cloud'))return'cloudy'; return'clear'; }
function applyTheme(kind){ document.body.className = document.body.className.split(' ').filter(c=>!c.startsWith('wx-')).join(' '); document.body.classList.add('wx-'+kind); }
function isNightLocal(d){ const h=parseInt(new Intl.DateTimeFormat('th-TH',{hour:'2-digit',hourCycle:'h23',timeZone:TZ}).format(new Date(d))); return (h>=18||h<6); }
function composeSky(kind, nowLocal){ const host=document.getElementById('wxfx'); if(!host) return; host.innerHTML=''; const orb=document.createElement('div'); orb.className=isNightLocal(nowLocal)?'moon':'sun'; host.appendChild(orb); const cc=(kind==='rain'||kind==='cloudy')?6:3; for(let i=0;i<cc;i++){ const c=document.createElement('div'); c.className='cloud'; c.style.top=(8+Math.random()*20)+'vh'; c.style.left=(-20+Math.random()*20)+'vw'; c.style.animationDuration=(50+Math.random()*40)+'s'; host.appendChild(c);} if(kind==='rain'){ const timer=setInterval(()=>{const d=document.createElement('div'); d.className='fxDrop'; d.style.left=Math.random()*100+'vw'; d.style.animationDuration=(1.1+Math.random()*0.9)+'s'; host.appendChild(d); setTimeout(()=>d.remove(),2000);},100); host.dataset.rainMaker=timer; } else { if(host.dataset.rainMaker){ clearInterval(parseInt(host.dataset.rainMaker)); host.dataset.rainMaker=''; } } }

// === clock / live line ===
let _clock=null;
function renderUpdatedLine(){ const el=document.getElementById('updatedAt'); if(!el) return; el.innerHTML = `<span class="live-dot"></span><span class="live-text">LIVE</span>อัปเดตล่าสุด  ${fmtThai(new Date())}`; }
function startClock(){ if(_clock) clearInterval(_clock); renderUpdatedLine(); _clock=setInterval(renderUpdatedLine, 60*1000); }

// === renderers ===
function renderCurrent(cur){
  const tempEl=document.getElementById('temp'), emo=document.getElementById('emoji');
  if(tempEl) tempEl.textContent = formatTemp(cur?.air_temperature);
  if(emo) emo.textContent = cur?.symbol_emoji || '⛅';

  const rh=document.getElementById('rh'); if(rh) rh.textContent = cur?.relative_humidity!=null? `${Math.round(cur.relative_humidity)}%` : '—%';
  const ws=document.getElementById('wind'); if(ws) ws.textContent = cur?.wind_speed_ms!=null? `${cur.wind_speed_ms.toFixed(1)} m/s` : '— m/s';
  const pr=document.getElementById('press'); if(pr) pr.textContent = cur?.pressure_hpa!=null? `${Math.round(cur.pressure_hpa)} hPa` : '— hPa';
  const rn=document.getElementById('rain'); if(rn) rn.textContent = cur?.precip_mm!=null? `${(cur.precip_mm||0).toFixed(1)} mm` : '— mm';

  const subtitle=document.querySelector('.subtitle'); if(subtitle) subtitle.textContent = cur?.place || 'Bangkok, TH';

  const kind=classifyWeather(cur?.symbol_code); applyTheme(kind); composeSky(kind, cur?.time_local || new Date());
}

function renderHourly(recent, nxt){
  const h=document.getElementById('hourly'); if(!h) return;
  const mk = x => `<div class="hitem"><div>${x.symbol_emoji||'—'}</div><div><b>${formatTemp(x.air_temperature)}</b></div><div class="muted">${timeHM(x.time_local)}</div><div class="muted">🌧 ${(x.precip_mm??0).toFixed(1)} mm</div></div>`;
  const past = (recent||[]).map(mk).join('');
  const future = (nxt||[]).map(mk).join('');
  h.innerHTML = past + (future? '<div id="nextDivider" class="divider">— ถัดไป —</div>' + future : '');
  const div=document.getElementById('nextDivider'); if(div && !window._scrolledOnce){ div.scrollIntoView({behavior:'smooth',block:'start'}); window._scrolledOnce=true; }
}

function renderDaily(list){
  const d=document.getElementById('daily'); if(!d) return;
  d.innerHTML = (list||[]).map(x=>`<div class="ditem"><div><b>${new Date(x.date).toLocaleDateString('th-TH',{weekday:'short'})}</b></div><div style="font-size:18px;margin:6px 0">${(x.tmin??'—')}–${(x.tmax??'—')}°C</div><div class="muted">🌧 ${(x.precip_mm??0).toFixed(1)} mm</div></div>`).join('');
}

// === controls ===
function applyUnitButtons(){ const c=document.getElementById('unitC'), f=document.getElementById('unitF'); if(c) c.classList.toggle('active', unit==='C'); if(f) f.classList.toggle('active', unit==='F'); }
function applyModeButtons(){ const isNight=document.body.classList.contains('night'); const L=document.getElementById('modeLight'), N=document.getElementById('modeNight'); if(L) L.classList.toggle('active', !isNight); if(N) N.classList.toggle('active', isNight); }

function initControls(){
  const btn=document.getElementById('btnRefresh');
  if(btn){ btn.addEventListener('click', ()=>{ btn.classList.add('blip'); setTimeout(()=>btn.classList.remove('blip'),500); fetchAll(); }); }
  const uc=document.getElementById('unitC'), uf=document.getElementById('unitF');
  if(uc) uc.addEventListener('click', ()=>{ unit='C'; localStorage.setItem('unit','C'); applyUnitButtons(); if(_lastCurrent){ renderCurrent(_lastCurrent); renderHourly(_lastRecent,_lastNext); } else { fetchAll(); } });
  if(uf) uf.addEventListener('click', ()=>{ unit='F'; localStorage.setItem('unit','F'); applyUnitButtons(); if(_lastCurrent){ renderCurrent(_lastCurrent); renderHourly(_lastRecent,_lastNext); } else { fetchAll(); } });
  const L=document.getElementById('modeLight'), N=document.getElementById('modeNight');
  if(L) L.addEventListener('click', ()=>{ document.body.classList.remove('night'); applyModeButtons(); });
  if(N) N.addEventListener('click', ()=>{ document.body.classList.add('night'); applyModeButtons(); });
  applyUnitButtons(); applyModeButtons();
}

// === fetch (with retry on first load) ===
async function fetchAll(){
  startClock(); showUiError('');
  try{
    const [current, recent, daily, next] = await Promise.all([
      fetch(`${API}/api/current`).then(r=>r.json()),
      fetch(`${API}/api/readings/recent?hours=12`).then(r=>r.json()),
      fetch(`${API}/api/summary/daily?days=7`).then(r=>r.json()),
      fetch(`${API}/api/readings/next?hours=6`).then(r=>r.json())
    ]);
    _lastCurrent=current; _lastRecent=recent; _lastDaily=daily; _lastNext=next;
    renderCurrent(current);
    renderHourly(recent, next);
    renderDaily(daily);
  }catch(e){
    console.error(e); showUiError('เชื่อมต่อ API ไม่ได้ • ตรวจสอบว่า service api ทำงานและ API_URL ถูกต้อง');
  }
}

async function fetchAllWithRetry(maxRetry=6){
  for(let i=0;i<maxRetry;i++){
    await fetchAll();
    if (_lastCurrent && _lastCurrent.air_temperature!=null) return;
    await new Promise(r=>setTimeout(r,1500));
  }
}

// === Boot ===
function boot(){
  initControls();
  fetchAllWithRetry();          // ยิงทันที
  setTimeout(fetchAllWithRetry, 500); // กัน race ตอน service เพิ่งสตาร์ท
}
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
