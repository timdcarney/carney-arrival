// assets/core.js
// ---- CONFIG: update only API_URL ----
window.CAP = {}; // global namespace

CAP.CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwxvAp7E9IgTOjP-ry5CNowhPVqLab76qjqiTlxCWZyY1S5FIhkB0dAEvGtipEZv262/exec',
  APP_NAME: 'Carney Arrival Predictor'
};

// ---- helpers ----
CAP.$ = s => document.querySelector(s);
CAP.fmt = {
  toLocal: iso => new Date(iso).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}),
  toLocalInput(iso){ if(!iso) return ''; const d=new Date(iso),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
};
CAP.escapeHtml = s => (s||'').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ---- state ----
CAP.state = { settings:null, predictions:[], winner:null };

// ---- API client (text/plain to avoid CORS preflight) ----
CAP.storage = {
  async api(action, payload={}){
    const u = CAP.CONFIG.API_URL;
    const res = await fetch(u, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify({action, payload}) });
    if(!res.ok){ const t=await res.text().catch(()=> ''); throw new Error(`API ${res.status}${t?` — ${t}`:''}`); }
    const data = await res.json(); if(data.error) throw new Error(data.error); return data;
  },
  listPredictions(){ return this.api('listPredictions'); },
  getSettings(){ return this.api('getSettings'); },
  // admin ops exposed for admin.html
  setWindow(startIso, adminPass){ return this.api('setWindow', {startIso, adminPass}); },
  toggleSubmissions(adminPass){ return this.api('toggleSubmissions', {adminPass}); },
  setActualArrival(iso, adminPass){ return this.api('setActualArrival', {iso, adminPass}); },
  exportCSV(adminPass){ return this.api('exportCSV', {adminPass}); },
  savePrediction(p){ return this.api('savePrediction', p); }
};

// ---- shared loaders ----
CAP.loadAll = async ()=>{
  const [s, l] = await Promise.all([CAP.storage.getSettings(), CAP.storage.listPredictions()]);
  CAP.state.settings = s.settings;
  CAP.state.predictions = l.predictions;
  return CAP.state;
};

// ---- reusable renderers ----
CAP.renderBoardInto = (tbodySel, entriesSel)=>{
  const s = CAP.state.settings, rows = [...CAP.state.predictions].sort((a,b)=> new Date(a.predictedAt)-new Date(b.predictedAt));
  const tbody = CAP.$(tbodySel); if(!tbody) return;
  tbody.innerHTML='';
  rows.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${CAP.escapeHtml(p.name)}</td>
                    <td>${CAP.fmt.toLocal(p.predictedAt)}</td>
                    <td class="muted">${CAP.fmt.toLocal(p.submittedAt)}</td>`;
    tbody.appendChild(tr);
  });
  if(entriesSel) CAP.$(entriesSel).textContent = `${rows.length} entries`;
};

CAP.renderHeatmapInto = (mountSel)=>{
  const s = CAP.state.settings, predictions = CAP.state.predictions || [];
  const mount = CAP.$(mountSel); if(!s || !mount) return;
  mount.innerHTML='';

  const start = new Date(s.windowStart); start.setHours(0,0,0,0);
  const buckets = Array.from({length:7}, ()=> Array(24).fill(0));
  predictions.forEach(p=>{
    const d = new Date(p.predictedAt);
    const off = Math.floor((d - start) / (24*3600*1000));
    if(off<0||off>6) return;
    buckets[off][d.getHours()]++;
  });

  let max=0; for(let c=0;c<7;c++) for(let r=0;r<24;r++) max=Math.max(max,buckets[c][r]);
  if(max===0){ mount.innerHTML='<div class="tiny muted">No guesses yet — be the first!</div>'; return; }

  const cellW=36, cellH=18, padL=50, padT=20, gap=6;
  const w = padL + 7*cellW + 6*gap + 10, h = padT + 24*cellH + 23*gap + 28;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class','hm-svg');

  const colorFor = v=>{
    if(v<=0) return '#f9fafb';
    const t=v/max, from=[245,243,255], to=[124,58,237];
    const mix=i=>Math.round(from[i]+(to[i]-from[i])*Math.pow(t,0.7));
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
  };

  // day labels
  for(let c=0;c<7;c++){
    const d=new Date(start); d.setDate(start.getDate()+c);
    const txt = d.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});
    const t = document.createElementNS(svg.namespaceURI,'text');
    t.setAttribute('x', padL + c*(cellW+gap) + cellW/2);
    t.setAttribute('y', 12); t.setAttribute('text-anchor','middle'); t.setAttribute('class','hm-label'); t.textContent = txt; svg.appendChild(t);
  }
  // hour labels
  for(let r=0;r<24;r++){
    const txt = new Date(0,0,0,r).toLocaleTimeString([], {hour:'numeric'});
    const t = document.createElementNS(svg.namespaceURI,'text');
    t.setAttribute('x', 6); t.setAttribute('y', padT + r*(cellH+gap) + cellH*0.72);
    t.setAttribute('class','hm-label'); t.textContent = txt; svg.appendChild(t);
  }
  // cells
  for(let c=0;c<7;c++){
    for(let r=0;r<24;r++){
      const rect = document.createElementNS(svg.namespaceURI,'rect');
      rect.setAttribute('x', padL + c*(cellW+gap));
      rect.setAttribute('y', padT + r*(cellH+gap));
      rect.setAttribute('width', cellW); rect.setAttribute('height', cellH);
      rect.setAttribute('class','hm-cell');
      rect.setAttribute('fill', colorFor(buckets[c][r]));
      svg.appendChild(rect);
    }
  }
  mount.appendChild(svg);
};

