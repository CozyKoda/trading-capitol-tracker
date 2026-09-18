(() => {
  'use strict';

  const KEY = 'tradingCapitalTracker.v2';
  const OLD_KEY = 'tradingCapitalTracker.v1';
  const DEFAULT = {
    version: 2.1,
    contributions: [],
    trades: [],
    settings: { riskPct: 0.5, dailyLossPct: 1, capitalMode: 'auto', manualCapitalCap: 500 }
  };

  let state = load();
  let deferredPrompt = null;

  const $ = id => document.getElementById(id);
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(n) || 0);
  const pct = n => `${(Number(n) || 0).toFixed(2)}%`;
  const fmt = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 8 });
  const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function localDateString(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function localTimeString(d = new Date()) { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function today() { return localDateString(); }
  function dateObj(s) { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); }
  function dateValue(s) { return dateObj(s)?.getTime() || 0; }
  function isoDate(d) { return localDateString(d); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && Array.isArray(raw.contributions) && Array.isArray(raw.trades)) return normalizeState(raw);
    } catch {}
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old && Array.isArray(old.contributions) && Array.isArray(old.trades)) {
        const migrated = migrateV1(old);
        localStorage.setItem(KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch {}
    return clone(DEFAULT);
  }

  function normalizeState(raw) {
    const out = clone(DEFAULT);
    out.contributions = Array.isArray(raw.contributions) ? raw.contributions : [];
    out.settings = { ...out.settings, ...(raw.settings || {}) };
    if (!['auto','manual'].includes(out.settings.capitalMode)) out.settings.capitalMode = 'auto';
    out.trades = (raw.trades || []).map(normalizeTrade);
    return out;
  }

  function normalizeTrade(t) {
    const trade = {
      id: t.id || uid(), entryDate: t.entryDate || today(), entryTime: t.entryTime || '', symbol: String(t.symbol || '').toUpperCase(),
      asset: t.asset || 'Stock', strategy: t.strategy || 'Trend pullback', qty: Number(t.qty || 0), entryPrice: Number(t.entryPrice || 0),
      stop: Number(t.stop || 0), target: Number(t.target || 0), quality: t.quality || '', emotion: t.emotion || '', notes: t.notes || '',
      checklist: { setup:false, confirm:false, size:false, stop:false, target:false, ...(t.checklist || {}) }, exits: Array.isArray(t.exits) ? t.exits.map(e => ({
        id: e.id || uid(), date: e.date || '', time: e.time || '', qty: Number(e.qty || 0), price: Number(e.price || 0), fees: Number(e.fees || 0),
        settlementDate: e.settlementDate || '', notes: e.notes || '', followedPlan: Boolean(e.followedPlan)
      })) : []
    };
    return trade;
  }

  function migrateV1(old) {
    const out = clone(DEFAULT);
    out.contributions = old.contributions || [];
    out.settings.riskPct = Number(old.settings?.riskPct ?? 0.5);
    out.settings.dailyLossPct = Number(old.settings?.dailyLossPct ?? 1);
    out.settings.capitalMode = 'auto';
    out.settings.manualCapitalCap = Number(old.settings?.capitalCeiling ?? 500);
    out.trades = (old.trades || []).map(t => {
      const nt = normalizeTrade({ ...t, entryTime:'', quality:'', emotion:'', checklist:{} });
      if (t.exitDate && t.exitPrice) nt.exits = [{ id:uid(), date:t.exitDate, time:'', qty:Number(t.qty), price:Number(t.exitPrice), fees:Number(t.fees || 0), settlementDate:t.settlementDate || (t.asset === 'Crypto' ? t.exitDate : settlementDateFor(t.exitDate)), notes:'Migrated from Version 1', followedPlan:false }];
      return nt;
    });
    return out;
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(state)); render(); }
  function contributionTotal() { return state.contributions.reduce((a,c) => a + Number(c.amount || 0), 0); }
  function tradeInitialCost(t) { return Number(t.entryPrice) * Number(t.qty); }
  function soldQty(t) { return t.exits.reduce((a,e) => a + Number(e.qty || 0), 0); }
  function remainingQty(t) { return Math.max(0, Number(t.qty) - soldQty(t)); }
  function exitPL(t,e) { return (Number(e.price) - Number(t.entryPrice)) * Number(e.qty) - Number(e.fees || 0); }
  function tradeRealizedPL(t) { return t.exits.reduce((a,e) => a + exitPL(t,e), 0); }
  function totalRealizedPL() { return state.trades.reduce((a,t) => a + tradeRealizedPL(t), 0); }
  function averageExitPrice(t) {
    const q = soldQty(t);
    return q > 0 ? t.exits.reduce((a,e) => a + Number(e.price || 0) * Number(e.qty || 0), 0) / q : 0;
  }
  function exitDateSummary(t) {
    if (!t.exits.length) return '—';
    const sorted = [...t.exits].filter(e => e.date).sort((a,b) => dateValue(a.date)-dateValue(b.date) || String(a.time||'').localeCompare(String(b.time||'')));
    if (!sorted.length) return '—';
    const first = sorted[0], last = sorted[sorted.length-1];
    if (sorted.length === 1) return `${first.date}${first.time ? `<br><small>${esc(first.time)}</small>` : ''}`;
    return `${last.date}${last.time ? `<br><small>${esc(last.time)}</small>` : ''}<br><small>${sorted.length} exits</small>`;
  }
  function exitProceeds(e) { return Number(e.price) * Number(e.qty) - Number(e.fees || 0); }
  function exitIsSettled(t,e) { return t.asset === 'Crypto' || (!!e.settlementDate && e.settlementDate <= today()); }
  function pendingExits(t) { return t.exits.filter(e => !exitIsSettled(t,e)); }

  function tradeStatus(t) {
    const remaining = remainingQty(t);
    if (remaining > 0 && t.exits.length === 0) return 'open';
    if (remaining > 0) return 'partial';
    if (pendingExits(t).length) return 'awaiting';
    return 'settled';
  }

  function capitalLimitFrom(capital) {
    if (state.settings.capitalMode === 'manual') return Math.max(0, Math.min(Number(state.settings.manualCapitalCap || 0), Math.max(0, capital)));
    return Math.max(0, capital);
  }

  function summary() {
    const contrib = contributionTotal();
    const pl = totalRealizedPL();
    const capital = contrib + pl;
    let settled = contrib;
    let unsettled = 0;
    let open = 0;
    for (const t of state.trades) {
      settled -= tradeInitialCost(t);
      open += remainingQty(t) * Number(t.entryPrice);
      for (const e of t.exits) {
        if (exitIsSettled(t,e)) settled += exitProceeds(e);
        else unsettled += exitProceeds(e);
      }
    }
    const capitalLimit = capitalLimitFrom(capital);
    const remainingCapitalRoom = Math.max(0, capitalLimit - open);
    const availableDeploy = Math.max(0, Math.min(settled, remainingCapitalRoom));
    return { contrib, pl, capital, settled, unsettled, open, capitalLimit, availableDeploy };
  }

  function setPLClass(el,val) { el.classList.remove('pos','neg'); if (val > 0) el.classList.add('pos'); if (val < 0) el.classList.add('neg'); }

  // Standard U.S. securities-market holiday calculator. Extraordinary closures are not predictable here.
  function nthWeekday(year, monthIndex, weekday, n) {
    const d = new Date(year, monthIndex, 1, 12);
    const offset = (7 + weekday - d.getDay()) % 7;
    d.setDate(1 + offset + (n - 1) * 7);
    return d;
  }
  function lastWeekday(year, monthIndex, weekday) {
    const d = new Date(year, monthIndex + 1, 0, 12);
    d.setDate(d.getDate() - ((7 + d.getDay() - weekday) % 7));
    return d;
  }
  function observedFixed(year, monthIndex, day) {
    const d = new Date(year, monthIndex, day, 12);
    if (d.getDay() === 6) d.setDate(d.getDate() - 1);
    else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return d;
  }
  function easterSunday(year) {
    const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31)-1,day=((h+l-7*m+114)%31)+1;
    return new Date(year,month,day,12);
  }
  function marketHolidaySet(year) {
    const set = new Set();
    const add = d => set.add(isoDate(d));
    add(observedFixed(year,0,1));
    add(nthWeekday(year,0,1,3)); // MLK
    add(nthWeekday(year,1,1,3)); // Presidents
    const easter = easterSunday(year); const goodFriday = new Date(easter); goodFriday.setDate(easter.getDate()-2); add(goodFriday);
    add(lastWeekday(year,4,1)); // Memorial
    if (year >= 2022) add(observedFixed(year,5,19));
    add(observedFixed(year,6,4));
    add(nthWeekday(year,8,1,1)); // Labor
    add(nthWeekday(year,10,4,4)); // Thanksgiving
    add(observedFixed(year,11,25));
    return set;
  }
  function isTradingDay(d) {
    if (d.getDay() === 0 || d.getDay() === 6) return false;
    const s = isoDate(d); const y = d.getFullYear();
    return !marketHolidaySet(y-1).has(s) && !marketHolidaySet(y).has(s) && !marketHolidaySet(y+1).has(s);
  }
  function settlementDateFor(exitDate) {
    const d = dateObj(exitDate); if (!d) return '';
    do { d.setDate(d.getDate() + 1); } while (!isTradingDay(d));
    return isoDate(d);
  }

  function allExitRecords() {
    const rows=[];
    for (const t of state.trades) for (const e of t.exits) rows.push({ trade:t, exit:e, pl:exitPL(t,e) });
    return rows;
  }

  function render() {
    renderSummary(); renderContributions(); renderTrades(); renderAnalytics(); renderBreakdowns(); renderMonthly(); renderChart(); renderCalendar(); renderSettings();
  }

  function renderSummary() {
    const s = summary();
    $('capitalValue').textContent = money(s.capital);
    $('availableDeploy').textContent = money(s.availableDeploy);
    $('settledCash').textContent = money(s.settled);
    $('unsettledCash').textContent = money(s.unsettled);
    $('openBasis').textContent = money(s.open);
    $('realizedPL').textContent = money(s.pl); setPLClass($('realizedPL'),s.pl);
    $('returnPct').textContent = pct(s.contrib ? 100*s.pl/s.contrib : 0); setPLClass($('returnPct'),s.pl);
    $('capitalLimitValue').textContent = money(s.capitalLimit);
    $('capitalLimitCaption').textContent = state.settings.capitalMode === 'auto' ? 'Automatic: this trading pool only' : 'Manual hard cap';
    const riskBase = s.capitalLimit;
    const maxTrade = riskBase * Number(state.settings.riskPct) / 100;
    const maxDay = riskBase * Number(state.settings.dailyLossPct) / 100;
    $('maxRiskTrade').textContent = money(maxTrade);
    $('maxRiskDay').textContent = money(maxDay);
    const todayPL = allExitRecords().filter(r => r.exit.date === today()).reduce((a,r) => a+r.pl,0);
    $('todayPL').textContent = money(todayPL); setPLClass($('todayPL'),todayPL);
    const remaining = Math.max(0,maxDay + Math.min(0,todayPL));
    $('remainingDailyRisk').textContent = money(remaining);
    const warn=$('dailyWarning');
    if (maxDay>0 && todayPL <= -maxDay) { warn.textContent=`Daily loss limit reached: ${money(todayPL)} versus your ${money(maxDay)} limit.`; warn.classList.remove('hidden'); }
    else warn.classList.add('hidden');
  }

  function renderContributions() {
    const tb=$('contributionRows'); tb.innerHTML='';
    [...state.contributions].sort((a,b)=>dateValue(b.date)-dateValue(a.date)).forEach(c=>{
      const tr=document.createElement('tr'); tr.innerHTML=`<td>${esc(c.date)}</td><td>${money(c.amount)}</td><td>${esc(c.note||'')}</td><td><button class="link-delete" data-contribution="${c.id}">Delete</button></td>`; tb.appendChild(tr);
    });
    tb.querySelectorAll('[data-contribution]').forEach(b=>b.onclick=()=>{ if(confirm('Delete this contribution?')) { state.contributions=state.contributions.filter(c=>c.id!==b.dataset.contribution); save(); } });
  }

  function filteredTrades() {
    const a=$('filterAsset').value,s=$('filterStatus').value,q=$('filterSymbol').value.trim().toUpperCase();
    return [...state.trades].filter(t=>(a==='all'||t.asset===a)&&(s==='all'||tradeStatus(t)===s)&&(!q||t.symbol.includes(q))).sort((x,y)=>dateValue(y.entryDate)-dateValue(x.entryDate));
  }

  function settlementDisplay(t) {
    const pending = pendingExits(t);
    if (!pending.length) return t.exits.length ? 'Settled' : '—';
    if (pending.length === 1) return pending[0].settlementDate || 'Pending';
    const dates=pending.map(e=>e.settlementDate).filter(Boolean).sort();
    return dates.length ? `${pending.length} pending · next ${dates[0]}` : `${pending.length} pending`;
  }

  function renderTrades() {
    const tb=$('tradeRows'); tb.innerHTML=''; const list=filteredTrades(); $('emptyTrades').classList.toggle('hidden',list.length>0);
    for (const t of list) {
      const pl=tradeRealizedPL(t), st=tradeStatus(t), rem=remainingQty(t);
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${esc(t.entryDate)}${t.entryTime?`<br><small>${esc(t.entryTime)}</small>`:''}</td><td>${exitDateSummary(t)}</td><td><strong>${esc(t.symbol)}</strong></td><td>${esc(t.asset)}</td><td>${fmt(t.qty)}</td><td>${fmt(rem)}</td><td>${money(t.entryPrice)}</td><td>${t.exits.length?money(averageExitPrice(t)):'—'}</td><td>${t.stop?money(t.stop):'—'}</td><td>${t.target?money(t.target):'—'}</td><td class="${pl>0?'pos':pl<0?'neg':''}">${t.exits.length?money(pl):'—'}</td><td><span class="status">${st==='open'?'Open':st==='partial'?'Partial':st==='awaiting'?'Awaiting':'Settled'}</span></td><td>${esc(settlementDisplay(t))}</td><td><div class="row-actions">${rem>0?`<button class="close-action" data-close="${t.id}">Close</button>`:''}<button data-history="${t.id}">Details</button><button data-edit="${t.id}">Edit</button><button data-delete="${t.id}">Delete</button></div></td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>openClose(state.trades.find(t=>t.id===b.dataset.close)));
    tb.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>openHistory(state.trades.find(t=>t.id===b.dataset.history)));
    tb.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openTrade(state.trades.find(t=>t.id===b.dataset.edit)));
    tb.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{ if(confirm('Delete this trade and all of its exit records?')) { state.trades=state.trades.filter(t=>t.id!==b.dataset.delete); save(); } });
  }

  function renderSettings() {
    $('riskPct').value=state.settings.riskPct; $('dailyLossPct').value=state.settings.dailyLossPct; $('capitalMode').value=state.settings.capitalMode; $('manualCapitalCap').value=state.settings.manualCapitalCap;
    const manual=state.settings.capitalMode==='manual'; $('manualCapWrap').classList.toggle('hidden',!manual);
    const s=summary();
    $('capitalModeHelp').textContent = manual
      ? `Manual mode limits total open cost basis to ${money(s.capitalLimit)} even if this trading pool grows larger.`
      : `Automatic mode uses this app's trading pool only: contributions + realized P/L (${money(s.capital)}). Long-term holdings are never included.`;
  }

  function renderAnalytics() {
    const records=allExitRecords(); const wins=records.filter(r=>r.pl>0), losses=records.filter(r=>r.pl<0);
    $('closedTrades').textContent = new Set(records.map(r=>r.trade.id)).size;
    $('winRate').textContent = records.length ? pct(100*wins.length/records.length) : '—';
    $('avgWin').textContent = wins.length ? money(wins.reduce((a,r)=>a+r.pl,0)/wins.length) : 'N/A';
    $('avgLoss').textContent = losses.length ? money(losses.reduce((a,r)=>a+r.pl,0)/losses.length) : 'N/A';
    const gp=wins.reduce((a,r)=>a+r.pl,0), gl=Math.abs(losses.reduce((a,r)=>a+r.pl,0));
    $('profitFactor').textContent = gl ? (gp/gl).toFixed(2) : (gp>0 ? 'N/A — no losses yet' : '—');
    const ordered=[...records].sort((a,b)=>dateValue(a.exit.date)-dateValue(b.exit.date) || String(a.exit.time).localeCompare(String(b.exit.time)));
    let equity=0,peak=0,dd=0,lossStreak=0,maxLossStreak=0;
    for(const r of ordered){ equity+=r.pl; peak=Math.max(peak,equity); dd=Math.max(dd,peak-equity); if(r.pl<0){lossStreak++;maxLossStreak=Math.max(maxLossStreak,lossStreak)}else if(r.pl>0)lossStreak=0; }
    $('maxDrawdown').textContent=money(dd); $('maxConsecutiveLosses').textContent=maxLossStreak;
    const rVals=[]; for(const t of state.trades){ const plannedRisk=t.stop?Math.abs(Number(t.entryPrice)-Number(t.stop))*Number(t.qty):0; if(plannedRisk>0 && t.exits.length) rVals.push(tradeRealizedPL(t)/plannedRisk); }
    $('avgR').textContent = rVals.length ? `${(rVals.reduce((a,v)=>a+v,0)/rVals.length).toFixed(2)}R` : '—';
  }

  function aggregateBy(keyFn) {
    const map={};
    for(const t of state.trades){ if(!t.exits.length)continue; const key=keyFn(t)||'Unspecified'; if(!map[key])map[key]={trades:0,wins:0,pl:0,r:[]}; map[key].trades++; const p=tradeRealizedPL(t); if(p>0)map[key].wins++; map[key].pl+=p; const risk=t.stop?Math.abs(t.entryPrice-t.stop)*t.qty:0;if(risk>0)map[key].r.push(p/risk); }
    return map;
  }

  function renderBreakdowns() {
    const smap=aggregateBy(t=>t.strategy); const stb=$('strategyRows'); stb.innerHTML='';
    Object.entries(smap).sort((a,b)=>b[1].pl-a[1].pl).forEach(([k,v])=>{const avgR=v.r.length?`${(v.r.reduce((a,n)=>a+n,0)/v.r.length).toFixed(2)}R`:'—';const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(k)}</td><td>${v.trades}</td><td>${pct(100*v.wins/v.trades)}</td><td class="${v.pl>0?'pos':v.pl<0?'neg':''}">${money(v.pl)}</td><td>${avgR}</td>`;stb.appendChild(tr)});
    if(!Object.keys(smap).length){const tr=document.createElement('tr');tr.innerHTML='<td colspan="5" class="muted">Close part or all of a trade to build strategy statistics.</td>';stb.appendChild(tr)}
    const amap=aggregateBy(t=>t.asset); const atb=$('assetRows'); atb.innerHTML='';
    Object.entries(amap).sort((a,b)=>b[1].pl-a[1].pl).forEach(([k,v])=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(k)}</td><td>${v.trades}</td><td>${pct(100*v.wins/v.trades)}</td><td class="${v.pl>0?'pos':v.pl<0?'neg':''}">${money(v.pl)}</td>`;atb.appendChild(tr)});
    if(!Object.keys(amap).length){const tr=document.createElement('tr');tr.innerHTML='<td colspan="4" class="muted">No realized trades yet.</td>';atb.appendChild(tr)}
  }

  function renderMonthly() {
    const map={}; for(const r of allExitRecords()){const m=r.exit.date?.slice(0,7); if(!m)continue; if(!map[m])map[m]={n:0,pl:0};map[m].n++;map[m].pl+=r.pl;}
    const tb=$('monthlyRows');tb.innerHTML='';Object.entries(map).sort((a,b)=>b[0].localeCompare(a[0])).forEach(([m,v])=>{const [y,mo]=m.split('-').map(Number);const label=new Date(y,mo-1,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});const tr=document.createElement('tr');tr.innerHTML=`<td>${esc(label)}</td><td>${v.n}</td><td class="${v.pl>0?'pos':v.pl<0?'neg':''}">${money(v.pl)}</td>`;tb.appendChild(tr)});if(!Object.keys(map).length){const tr=document.createElement('tr');tr.innerHTML='<td colspan="3" class="muted">No realized P/L yet.</td>';tb.appendChild(tr)}
  }

  function renderChart() {
    const box=$('equityChart'); const rows=allExitRecords().sort((a,b)=>dateValue(a.exit.date)-dateValue(b.exit.date));
    if(!rows.length){box.innerHTML='<div class="chart-empty">Your cumulative realized P/L curve will appear after you record an exit.</div>';return;}
    let cum=0; const vals=rows.map((r,i)=>({i,val:(cum+=r.pl),date:r.exit.date})); const min=Math.min(0,...vals.map(v=>v.val)),max=Math.max(0,...vals.map(v=>v.val)); const span=Math.max(1,max-min); const w=700,h=210,pad=28; const x=i=>pad+(vals.length===1?(w-2*pad)/2:i*(w-2*pad)/(vals.length-1)); const y=v=>pad+(max-v)*(h-2*pad)/span; const points=vals.map(v=>`${x(v.i)},${y(v.val)}`).join(' '); const zeroY=y(0);
    box.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Cumulative realized profit and loss"><line class="chart-axis" x1="${pad}" y1="${zeroY}" x2="${w-pad}" y2="${zeroY}"/><polyline class="chart-line" points="${points}"/><text class="chart-label" x="4" y="${pad+4}">${esc(money(max))}</text><text class="chart-label" x="4" y="${h-pad}">${esc(money(min))}</text><text class="chart-label" x="${pad}" y="${h-5}">${esc(vals[0].date)}</text><text class="chart-label" text-anchor="end" x="${w-pad}" y="${h-5}">${esc(vals[vals.length-1].date)}</text></svg>`;
  }

  function renderCalendar() {
    const box=$('plCalendar'); box.innerHTML=''; const now=new Date(); const y=now.getFullYear(),m=now.getMonth(); const heads=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];heads.forEach(h=>{const d=document.createElement('div');d.className='cal-head';d.textContent=h;box.appendChild(d)});
    const first=new Date(y,m,1,12),days=new Date(y,m+1,0,12).getDate(); const map={};for(const r of allExitRecords()){const d=dateObj(r.exit.date);if(d&&d.getFullYear()===y&&d.getMonth()===m)map[r.exit.date]=(map[r.exit.date]||0)+r.pl;}
    for(let i=0;i<first.getDay();i++){const d=document.createElement('div');d.className='cal-day blank';box.appendChild(d)}
    for(let day=1;day<=days;day++){const dObj=new Date(y,m,day,12), key=isoDate(dObj),pl=map[key]||0;const d=document.createElement('div');d.className=`cal-day${key===today()?' today':''}`;d.innerHTML=`<strong>${day}</strong>${map[key]!==undefined?`<div class="cal-pl ${pl>0?'pos':pl<0?'neg':''}">${esc(money(pl))}</div>`:''}`;box.appendChild(d)}
  }

  function openContribution() { $('contribDate').value=today(); $('contribAmount').value=500; $('contribNote').value='Monthly contribution'; $('contributionDialog').showModal(); }

  function openTrade(t=null) {
    $('tradeForm').reset(); $('editTradeId').value=t?.id||''; $('tradeDialogTitle').textContent=t?'Edit open-trade details':'Open trade'; $('saveTrade').textContent=t?'Save changes':'Save open trade';
    $('tradeDate').value=t?.entryDate||today(); $('tradeTime').value=t?.entryTime||localTimeString(); $('tradeSymbol').value=t?.symbol||''; $('tradeAsset').value=t?.asset||'Stock'; $('tradeStrategy').value=t?.strategy||'Trend pullback'; $('tradeQty').value=t?.qty||''; $('tradeEntry').value=t?.entryPrice||''; $('tradeStop').value=t?.stop||''; $('tradeTarget').value=t?.target||''; $('tradeQuality').value=t?.quality||''; $('tradeEmotion').value=t?.emotion||''; $('tradeNotes').value=t?.notes||'';
    $('checkSetup').checked=Boolean(t?.checklist?.setup); $('checkConfirm').checked=Boolean(t?.checklist?.confirm); $('checkSize').checked=Boolean(t?.checklist?.size); $('checkStop').checked=Boolean(t?.checklist?.stop); $('checkTarget').checked=Boolean(t?.checklist?.target);
    const exitSection=$('editExitSection'), exitRows=$('editExitRows'); exitRows.innerHTML='';
    if(t?.exits?.length){
      exitSection.classList.remove('hidden');
      [...t.exits].sort((a,b)=>dateValue(a.date)-dateValue(b.date) || String(a.time||'').localeCompare(String(b.time||''))).forEach(e=>{
        const row=document.createElement('div'); row.className='exit-edit-row'; const ep=exitPL(t,e);
        row.innerHTML=`<span>Date<strong>${esc(e.date)}${e.time?` ${esc(e.time)}`:''}</strong></span><span>Qty<strong>${fmt(e.qty)}</strong></span><span>Exit price<strong>${money(e.price)}</strong></span><span>P/L<strong class="${ep>0?'pos':ep<0?'neg':''}">${money(ep)}</strong></span><span>Settlement<strong>${t.asset==='Crypto'?'N/A':esc(e.settlementDate||'—')}</strong></span><span>Fees<strong>${money(e.fees||0)}</strong></span><button type="button" class="ghost" data-edit-exit="${e.id}">Edit sale</button>`;
        exitRows.appendChild(row);
      });
      exitRows.querySelectorAll('[data-edit-exit]').forEach(b=>b.onclick=()=>openEditExit(t,t.exits.find(e=>e.id===b.dataset.editExit)));
    } else exitSection.classList.add('hidden');
    $('tradeValidation').classList.add('hidden'); updateTradeMetrics(); $('tradeDialog').showModal();
  }

  function openClose(t) {
    const rem=remainingQty(t); $('closeForm').reset(); $('closeTradeId').value=t.id; $('closeDialogTitle').textContent=`Close ${t.symbol}`; $('closeDate').value=today(); $('closeTime').value=localTimeString(); $('closeQty').value=rem; $('closeQty').max=rem; $('closeFees').value=0; $('closeValidation').classList.add('hidden'); $('closePositionSummary').innerHTML=`<strong>${esc(t.symbol)}</strong> · ${fmt(rem)} remaining @ ${money(t.entryPrice)} entry`; updateCloseSettlement(); $('closeDialog').showModal();
  }

  function openHistory(t) {
    $('historyTitle').textContent=`${t.symbol} trade details`; const plannedRisk=t.stop?Math.abs(t.entryPrice-t.stop)*t.qty:0; const p=tradeRealizedPL(t); const rr=plannedRisk>0&&t.exits.length?`${(p/plannedRisk).toFixed(2)}R`:'—';
    const exits=[...t.exits].sort((a,b)=>dateValue(a.date)-dateValue(b.date)||String(a.time||'').localeCompare(String(b.time||''))); const firstExit=exits[0], finalExit=exits[exits.length-1];
    let html=`<div class="detail-grid"><div><span>Entry</span><strong>${esc(t.entryDate)} ${esc(t.entryTime||'')}</strong></div><div><span>Entry price</span><strong>${money(t.entryPrice)}</strong></div><div><span>First exit</span><strong>${firstExit?`${esc(firstExit.date)} ${esc(firstExit.time||'')}`:'—'}</strong></div><div><span>Final exit</span><strong>${finalExit?`${esc(finalExit.date)} ${esc(finalExit.time||'')}`:'—'}</strong></div><div><span>Avg exit price</span><strong>${t.exits.length?money(averageExitPrice(t)):'—'}</strong></div><div><span>Quantity</span><strong>${fmt(t.qty)}</strong></div><div><span>Strategy</span><strong>${esc(t.strategy)}</strong></div><div><span>Planned stop</span><strong>${t.stop?money(t.stop):'—'}</strong></div><div><span>Planned target</span><strong>${t.target?money(t.target):'—'}</strong></div><div><span>Realized P/L</span><strong class="${p>0?'pos':p<0?'neg':''}">${money(p)}</strong></div><div><span>Realized R</span><strong>${rr}</strong></div><div><span>Remaining</span><strong>${fmt(remainingQty(t))}</strong></div></div>`;
    html+=`<p><strong>Notes:</strong> ${esc(t.notes||'—')}</p>`;
    if(t.exits.length){html+='<div class="table-wrap"><table class="history-exits"><thead><tr><th>Exit date/time</th><th>Qty</th><th>Exit price</th><th>Fees</th><th>P/L</th><th>Settlement</th><th>Plan followed</th><th></th></tr></thead><tbody>';for(const e of exits){const ep=exitPL(t,e);html+=`<tr><td>${esc(e.date)} ${esc(e.time||'')}</td><td>${fmt(e.qty)}</td><td>${money(e.price)}</td><td>${money(e.fees||0)}</td><td class="${ep>0?'pos':ep<0?'neg':''}">${money(ep)}</td><td>${t.asset==='Crypto'?'N/A':esc(e.settlementDate||'')}</td><td>${e.followedPlan?'Yes':'No / not recorded'}</td><td><button type="button" data-history-edit-exit="${e.id}">Edit sale</button></td></tr>`;}html+='</tbody></table></div>';}else html+='<p class="muted">No exits recorded yet.</p>';
    $('historyBody').innerHTML=html; $('historyBody').querySelectorAll('[data-history-edit-exit]').forEach(b=>b.onclick=()=>openEditExit(t,t.exits.find(e=>e.id===b.dataset.historyEditExit))); $('historyDialog').showModal();
  }

  function updateTradeMetrics() {
    const entry=Number($('tradeEntry').value),qty=Number($('tradeQty').value),stop=Number($('tradeStop').value),target=Number($('tradeTarget').value),s=summary(); const editing=state.trades.find(t=>t.id===$('editTradeId').value); const existingOpen=editing?remainingQty(editing)*editing.entryPrice:0; const available=s.availableDeploy+existingOpen; const cost=entry*qty; const risk=stop>0?Math.abs(entry-stop)*qty:0; const reward=target>0?Math.abs(target-entry)*qty:0; const maxRisk=s.capitalLimit*state.settings.riskPct/100;
    $('tradeMetricCost').textContent=entry>0&&qty>0?money(cost):'—'; $('tradeMetricRisk').textContent=risk>0?money(risk):'—'; $('tradeMetricReward').textContent=reward>0?money(reward):'—'; $('tradeMetricRR').textContent=risk>0&&reward>0?`1 : ${(reward/risk).toFixed(2)}`:'—'; $('tradeMetricDeployPct').textContent=s.capitalLimit>0&&cost>0?pct(100*cost/s.capitalLimit):'—'; $('tradeMetricMaxRisk').textContent=money(maxRisk);
    const el=$('tradeValidation'); const messages=[]; if(cost>available+.005)messages.push(`Position cost ${money(cost)} exceeds the ${money(available)} currently available to deploy.`); if(risk>maxRisk+.005)messages.push(`Planned stop risk ${money(risk)} exceeds your ${money(maxRisk)} per-trade risk limit.`); if(messages.length){el.textContent=messages.join(' ');el.classList.remove('hidden')}else el.classList.add('hidden');
  }

  function validateTrade(t,editingId='') {
    if(!(t.qty>0)||!(t.entryPrice>0)||!t.symbol)return 'Enter a symbol, positive quantity, and positive entry price.';
    const s=summary(); const existing=editingId?state.trades.find(x=>x.id===editingId):null; const existingOpen=existing?remainingQty(existing)*existing.entryPrice:0; const available=s.availableDeploy+existingOpen; const cost=tradeInitialCost(t); if(cost>available+.005)return `Position cost ${money(cost)} exceeds the ${money(available)} currently available to deploy.`;
    if(existing && soldQty(existing)>0 && t.qty < soldQty(existing)-1e-8)return `Quantity cannot be reduced below the ${fmt(soldQty(existing))} shares/units already sold.`;
    if(t.stop){const planned=Math.abs(t.entryPrice-t.stop)*t.qty;const max=s.capitalLimit*state.settings.riskPct/100;if(planned>max+.005)return `Planned stop risk is ${money(planned)}, above your per-trade limit of ${money(max)}.`}
    return '';
  }

  function updateCloseSettlement() {
    const t=state.trades.find(x=>x.id===$('closeTradeId').value); const d=$('closeDate').value; $('closeSettlement').value=t?.asset==='Crypto'?(d||''):(d?settlementDateFor(d):'');
  }

  function openEditExit(t,e) {
    if(!t||!e)return;
    if ($('tradeDialog').open) $('tradeDialog').close();
    if ($('historyDialog').open) $('historyDialog').close();
    $('editExitTradeId').value=t.id; $('editExitId').value=e.id; $('editExitTitle').textContent=`Edit ${t.symbol} sale`;
    $('editExitDate').value=e.date||''; $('editExitTime').value=e.time||''; $('editExitQty').value=e.qty; $('editExitPrice').value=e.price; $('editExitFees').value=e.fees||0; $('editExitSettlement').value=t.asset==='Crypto'?(e.date||''):(e.date?settlementDateFor(e.date):''); $('editExitNotes').value=e.notes||''; $('editExitFollowedPlan').checked=Boolean(e.followedPlan); $('editExitValidation').classList.add('hidden');
    $('editExitDialog').showModal();
  }

  function updateEditExitSettlement() {
    const t=state.trades.find(x=>x.id===$('editExitTradeId').value); const d=$('editExitDate').value; $('editExitSettlement').value=t?.asset==='Crypto'?(d||''):(d?settlementDateFor(d):'');
  }

  $('addContributionBtn').onclick=openContribution;
  $('addTradeBtn').onclick=()=>openTrade();
  $('saveContribution').onclick=e=>{e.preventDefault();const amount=Number($('contribAmount').value);if(!(amount>0))return;state.contributions.push({id:uid(),date:$('contribDate').value,amount,note:$('contribNote').value.trim()});$('contributionDialog').close();save();};

  $('saveTrade').onclick=e=>{
    e.preventDefault(); const id=$('editTradeId').value||uid(); const old=state.trades.find(x=>x.id===id);
    const t=normalizeTrade({ id, entryDate:$('tradeDate').value, entryTime:$('tradeTime').value, symbol:$('tradeSymbol').value.trim().toUpperCase(), asset:$('tradeAsset').value, strategy:$('tradeStrategy').value, qty:Number($('tradeQty').value), entryPrice:Number($('tradeEntry').value), stop:Number($('tradeStop').value)||0, target:Number($('tradeTarget').value)||0, quality:$('tradeQuality').value, emotion:$('tradeEmotion').value, notes:$('tradeNotes').value.trim(), checklist:{setup:$('checkSetup').checked,confirm:$('checkConfirm').checked,size:$('checkSize').checked,stop:$('checkStop').checked,target:$('checkTarget').checked}, exits:old?.exits||[] });
    const msg=validateTrade(t,$('editTradeId').value); if(msg){$('tradeValidation').textContent=msg;$('tradeValidation').classList.remove('hidden');return} const i=state.trades.findIndex(x=>x.id===id); if(i>=0)state.trades[i]=t;else state.trades.push(t);$('tradeDialog').close();save();
  };

  $('saveClose').onclick=e=>{
    e.preventDefault(); const t=state.trades.find(x=>x.id===$('closeTradeId').value); if(!t)return; const qty=Number($('closeQty').value),price=Number($('closePrice').value),rem=remainingQty(t); if(!(qty>0)||qty>rem+1e-8||!(price>0)){ $('closeValidation').textContent=`Enter a positive quantity no greater than ${fmt(rem)} and a positive exit price.`;$('closeValidation').classList.remove('hidden');return; }
    const date=$('closeDate').value; const ex={id:uid(),date,time:$('closeTime').value,qty,price,fees:Number($('closeFees').value)||0,settlementDate:t.asset==='Crypto'?date:settlementDateFor(date),notes:$('closeNotes').value.trim(),followedPlan:$('closeFollowedPlan').checked}; t.exits.push(ex); $('closeDialog').close(); save();
  };

  $('saveExitEdit').onclick=e=>{
    e.preventDefault(); const t=state.trades.find(x=>x.id===$('editExitTradeId').value); if(!t)return; const ex=t.exits.find(x=>x.id===$('editExitId').value); if(!ex)return;
    const qty=Number($('editExitQty').value), price=Number($('editExitPrice').value), otherSold=t.exits.filter(x=>x.id!==ex.id).reduce((a,x)=>a+Number(x.qty||0),0), maxQty=Math.max(0,Number(t.qty)-otherSold);
    if(!(qty>0)||qty>maxQty+1e-8||!(price>0)||!$('editExitDate').value){ $('editExitValidation').textContent=`Enter a valid date, positive price, and quantity no greater than ${fmt(maxQty)}.`; $('editExitValidation').classList.remove('hidden'); return; }
    ex.date=$('editExitDate').value; ex.time=$('editExitTime').value; ex.qty=qty; ex.price=price; ex.fees=Number($('editExitFees').value)||0; ex.settlementDate=t.asset==='Crypto'?ex.date:settlementDateFor(ex.date); ex.notes=$('editExitNotes').value.trim(); ex.followedPlan=$('editExitFollowedPlan').checked;
    $('editExitDialog').close(); $('tradeDialog').close(); $('historyDialog').close(); save();
  };

  $('capitalMode').onchange=()=>{const manual=$('capitalMode').value==='manual';$('manualCapWrap').classList.toggle('hidden',!manual);};
  $('saveSettings').onclick=()=>{state.settings.riskPct=Math.max(.01,Number($('riskPct').value)||.5);state.settings.dailyLossPct=Math.max(.01,Number($('dailyLossPct').value)||1);state.settings.capitalMode=$('capitalMode').value==='manual'?'manual':'auto';state.settings.manualCapitalCap=Math.max(0,Number($('manualCapitalCap').value)||0);save();};
  $('refreshSettlementBtn').onclick=()=>render();
  ['filterAsset','filterStatus','filterSymbol'].forEach(id=>$(id).addEventListener(id==='filterSymbol'?'input':'change',renderTrades));
  ['tradeQty','tradeEntry','tradeStop','tradeTarget'].forEach(id=>$(id).addEventListener('input',updateTradeMetrics));
  $('closeDate').addEventListener('change',updateCloseSettlement);
  $('editExitDate').addEventListener('change',updateEditExitSettlement);

  $('calcPosition').onclick=()=>{const entry=Number($('calcEntry').value),stop=Number($('calcStop').value),target=Number($('calcTarget').value),risk=Math.abs(entry-stop),s=summary(),budget=s.capitalLimit*state.settings.riskPct/100;if(!(entry>0)||!(stop>0)||risk<=0){$('calcNote').textContent='Enter different positive entry and stop prices.';return}let qty=Math.floor(budget/risk);qty=Math.min(qty,Math.floor(s.availableDeploy/entry));qty=Math.max(0,qty);$('calcRiskShare').textContent=money(risk);$('calcShares').textContent=qty;$('calcPositionValue').textContent=money(qty*entry);$('calcRR').textContent=target>0?`1 : ${(Math.abs(target-entry)/risk).toFixed(2)}`:'—';$('calcNote').textContent=qty?`At ${fmt(qty)} shares, planned stop risk is about ${money(qty*risk)}. Available-to-deploy cash is ${money(s.availableDeploy)}.`:'Your current settled cash, capital limit, or risk setting does not support a whole-share position at this price.';};

  function download(name,type,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
  $('exportJson').onclick=()=>download(`trading-tracker-v2.1-backup-${today()}.json`,'application/json',JSON.stringify(state,null,2));
  $('exportCsv').onclick=()=>{const rows=[['Entry Date','Entry Time','Symbol','Asset','Strategy','Original Quantity','Entry Price','Stop','Target','Exit Date','Exit Time','Exit Quantity','Exit Price','Fees','Settlement Date','Realized P/L','Followed Plan','Notes'],...allExitRecords().map(r=>[r.trade.entryDate,r.trade.entryTime,r.trade.symbol,r.trade.asset,r.trade.strategy,r.trade.qty,r.trade.entryPrice,r.trade.stop||'',r.trade.target||'',r.exit.date,r.exit.time,r.exit.qty,r.exit.price,r.exit.fees,r.exit.settlementDate,r.pl,r.exit.followedPlan?'Yes':'No',r.exit.notes||r.trade.notes||''])];const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');download(`trades-v2.1-${today()}.csv`,'text/csv',csv)};
  $('importJson').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!data||!Array.isArray(data.contributions)||!Array.isArray(data.trades))throw new Error();if(confirm('Replace current local data with this backup?')){state=normalizeState(data);save()}}catch{alert('That file is not a valid Trading Capital Tracker backup.')}finally{e.target.value=''}};
  $('resetData').onclick=()=>{if(confirm('Reset all app data? This cannot be undone unless you have an exported backup.')){state=clone(DEFAULT);localStorage.removeItem(KEY);save()}};

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').classList.remove('hidden')});
  $('installBtn').onclick=async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').classList.add('hidden')};
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

  if(!state.contributions.length){state.contributions.push({id:uid(),date:today(),amount:500,note:'Initial trading capital'});save()}else render();
})();
