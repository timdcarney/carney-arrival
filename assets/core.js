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

  // ---- data bucketing: 7 days x 24 hours ----
  const start = new Date(s.windowStart); start.setHours(0,0,0,0);
  const buckets = Array.from({length:7}, ()=> Array(24).fill(0));
  predictions.forEach(p=>{
    const d = new Date(p.predictedAt);
    const off = Math.floor((d - start) / (24*3600*1000));
    if(off<0 || off>6) return;
    buckets[off][d.getHours()]++;
  });
  let max=0; for(let c=0;c<7;c++) for(let r=0;r<24;r++) max=Math.max(max,buckets[c][r]);
  if(max===0){ mount.innerHTML='<div class="tiny muted">No guesses yet — be the first!</div>'; return; }

  // ---- responsive sizing based on container width ----
  const containerW = mount.clientWidth || 900;
  const padL = 64;             // left gutter for hour labels
  const padR = 12, padT = 42, padB = 28;
  const cols = 7, rows = 24, gap = 6;

  // compute cell width so 7 columns + gaps fit container
  const cellW = Math.max(30, Math.floor((containerW - padL - padR - (cols-1)*gap) / cols));
  const cellH = Math.max(16, Math.round(cellW * 0.55)); // keep a pleasant ratio

  const width  = padL + cols*cellW + (cols-1)*gap + padR;
  const height = padT + rows*cellH + (rows-1)*gap + padB;

  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class','hm-svg');

  // ---- color scale: pastel → vivid violet ----
  const colorFor = v=>{
    if(v<=0) return '#f9fafb';
    const t = v / max;
    // perceptual-ish power to keep mid-tones distinct
    const k = Math.pow(t, 0.70);
    const from=[235,233,255], to=[124,58,237];
    const mix=i=>Math.round(from[i] + (to[i]-from[i]) * k);
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
  };

  const ns = svg.namespaceURI;

  // ---- column day labels (two lines: "Wed" and "Oct 8") ----
  for(let c=0;c<cols;c++){
    const d=new Date(start); d.setDate(start.getDate()+c);
    const day = d.toLocaleDateString([], {weekday:'short'});
    const md  = d.toLocaleDateString([], {month:'short', day:'numeric'});

    const tx = document.createElementNS(ns,'text');
    tx.setAttribute('x', padL + c*(cellW+gap) + cellW/2);
    tx.setAttribute('y', 16);
    tx.setAttribute('text-anchor','middle');
    tx.setAttribute('class','hm-day');

    const t1 = document.createElementNS(ns,'tspan'); t1.textContent = day;
    const t2 = document.createElementNS(ns,'tspan'); t2.textContent = md; t2.setAttribute('x', tx.getAttribute('x')); t2.setAttribute('dy','1.2em');
    tx.appendChild(t1); tx.appendChild(t2);
    svg.appendChild(tx);
  }

  // ---- row hour labels ----
  for(let r=0;r<rows;r++){
    const label = new Date(0,0,0,r).toLocaleTimeString([], {hour:'numeric'});
    const t = document.createElementNS(ns,'text');
    t.setAttribute('x', 8);
    t.setAttribute('y', padT + r*(cellH+gap) + cellH*0.72);
    t.setAttribute('class','hm-hour');
    t.textContent = label;
    svg.appendChild(t);
  }

  // ---- light gridlines for readability (vertical) ----
  for(let c=0;c<=cols;c++){
    const x = padL + c*cellW + Math.max(0,c-1)*gap - (c===0?0:gap/2);
    const line = document.createElementNS(ns,'line');
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    line.setAttribute('y1', padT - 6); line.setAttribute('y2', height - padB + 6);
    line.setAttribute('class','gridline');
    svg.appendChild(line);
  }

  // ---- cells + optional counts + native tooltip via <title> ----
  const showCounts = (cellW >= 46 && cellH >= 20);  // only if there is room
  for(let c=0;c<cols;c++){
    for(let r=0;r<rows;r++){
      const v = buckets[c][r];
      const x = padL + c*(cellW+gap);
      const y = padT + r*(cellH+gap);

      const rect = document.createElementNS(ns,'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', cellW); rect.setAttribute('height', cellH);
      rect.setAttribute('class','hm-cell'); rect.setAttribute('fill', colorFor(v));

      const d=new Date(start); d.setDate(start.getDate()+c);
      d.setHours(r,0,0,0);
      const title = document.createElementNS(ns,'title');
      title.textContent = `${d.toLocaleString([], {weekday:'short', month:'short', day:'numeric', hour:'numeric'})} — ${v} guess${v===1?'':'es'}`;
      rect.appendChild(title);
      svg.appendChild(rect);

      if(showCounts && v>0){
        const tx = document.createElementNS(ns,'text');
        tx.setAttribute('x', x + cellW/2);
        tx.setAttribute('y', y + cellH*0.68);
        tx.setAttribute('text-anchor','middle');
        tx.setAttribute('class','hm-count');
        tx.textContent = String(v);
        svg.appendChild(tx);
      }
    }
  }

  // ---- mount + legend ----
  mount.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'legend tiny muted';
  legend.innerHTML = `
    <span>Fewer</span>
    <span class="swatch" style="background:#f9fafb"></span>
    <span class="swatch" style="background:${colorFor(Math.ceil(max*0.25))}"></span>
    <span class="swatch" style="background:${colorFor(Math.ceil(max*0.5))}"></span>
    <span class="swatch" style="background:${colorFor(Math.ceil(max*0.75))}"></span>
    <span class="swatch" style="background:${colorFor(max)}"></span>
    <span>More</span>
  `;
  mount.appendChild(legend);
};


