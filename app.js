// Bro Reports: the BroViewer Backtest tabs as a static site (data written by BroViewer's website export, MainWindow.WebExport.cs).
// The numbers come from the app's own code; this file only lays them out.
'use strict';
const $app = document.getElementById('app');
const LW = window.LightweightCharts;
let INDEX = null;
const cacheTests = {};
const state = { group: 'Top 10', sort: 'ratio', open: new Set() };
const charts = [];
// the chart library may still paint once after a chart was removed on a tab change: harmless, kept out of the console
window.addEventListener('error', e => { if (/Object is disposed/.test(e.message || '')) e.preventDefault(); });

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = v => v == null ? '-' : Math.round(v).toLocaleString('en-US');
const money = v => v == null ? '-' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = v => v == null ? '-' : (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
const r3 = v => v == null ? '-' : (v > 0 ? '+' : '') + v.toFixed(3);
const pct = v => v == null ? '-' : (v * 100).toFixed(1) + '%';
const tone = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const ratio = t => t.maxDd > 0 ? t.net / t.maxDd : t.net > 0 ? 99 : 0;
const prettyDay = d => d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-';
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function nyParts(ms) { const p = {}; for (const x of nyFmt.formatToParts(new Date(ms))) p[x.type] = x.value; return p; }
const nyText = ms => { const p = nyParts(ms); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
// New York wall time as chart seconds (the charts draw UTC; shifting by New York's offset shows New York times)
const offCache = new Map();
function nySec(ms) {
  const hourKey = Math.floor(ms / 3600000);
  if (!offCache.has(hourKey)) { const p = nyParts(ms); const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); offCache.set(hourKey, Math.round((asUtc - ms) / 60000) * 60); }
  return Math.floor(ms / 1000) + offCache.get(hourKey);
}
async function getJson(url) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
function clearCharts() { while (charts.length) { const x = charts.pop(); try { x.ro.disconnect(); x.c.remove(); } catch (e) { } } }
const chartOpts = el => ({
  width: el.clientWidth, height: el.clientHeight, layout: { background: { color: 'transparent' }, textColor: '#8491a6', fontFamily: 'Inter, Segoe UI, sans-serif' },
  grid: { vertLines: { color: 'rgba(36,46,64,.6)' }, horzLines: { color: 'rgba(36,46,64,.6)' } }, rightPriceScale: { borderColor: '#242e40' },
  timeScale: { borderColor: '#242e40', timeVisible: true, secondsVisible: false }, crosshair: { mode: 0 }
});
function makeChart(el) {
  const c = LW.createChart(el, chartOpts(el));
  const ro = new ResizeObserver(() => { try { c.applyOptions({ width: el.clientWidth, height: el.clientHeight }); } catch (e) { ro.disconnect(); } });
  ro.observe(el); charts.push({ c, ro });
  return c;
}
// a chart drawn again inside the same box (Equity / Daily PnL switch): the old one goes first
function disposeIn(el) { for (let i = charts.length - 1; i >= 0; i--) if (el.contains(charts[i].c.chartElement())) { const x = charts.splice(i, 1)[0]; try { x.ro.disconnect(); x.c.remove(); } catch (e) { } } }
function table(title, heads, rows, signCols = [], cls = '') {
  const th = heads.map(h => `<th>${esc(h)}</th>`).join('');
  const tr = rows.map(r => `<tr class="${r.cls || ''}" ${r.attr || ''}>` + (r.cells || r).map((c, i) => {
    const v = typeof c === 'number' ? c : parseFloat(String(c).replace(/[$,R%+]/g, ''));
    return `<td class="${signCols.includes(i) && isFinite(v) ? tone(String(c).startsWith('-') ? -1 : v) : ''}">${esc(c)}</td>`;
  }).join('') + '</tr>').join('');
  return (title ? `<div class="tt">${esc(title)}</div>` : '') + `<div class="tbl ${cls}"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
const SUM_HEADS = ['', 'Trades', 'Win', 'Avg R', 'Total R', 'PF', 'Max DD R', 'Net $', 't'];
const sumRow = (name, s) => [name, String(s.trades), pct(s.winRate), r3(s.avgR), (s.totalR > 0 ? '+' : '') + (s.totalR ?? 0).toFixed(1), s.pf == null ? '∞' : s.pf.toFixed(2), (s.maxDdR ?? 0).toFixed(1), n0(s.net), (s.t ?? 0).toFixed(2)];
const sumTable = (title, rows) => table(title, SUM_HEADS, rows.map(r => sumRow(r.key, r.s)), [3, 4, 7]);

// ---------- routing ----------
window.addEventListener('hashchange', route);
(async function start() {
  try { INDEX = await getJson('data/index.json'); } catch (e) { $app.innerHTML = '<div class="loading">No reports published yet.</div>'; return; }
  document.getElementById('gen').textContent = 'Updated ' + INDEX.generated;
  route();
})();
function params() { const h = location.hash.slice(1); const [path, q] = h.split('?'); return { path: path || '/', q: new URLSearchParams(q || '') }; }
function route() { clearCharts(); const { path, q } = params(); if (path.startsWith('/t/')) showTest(path.slice(3), q); else showHome(); window.scrollTo(0, 0); }
function go(path, q) { location.hash = path + (q ? '?' + new URLSearchParams(q).toString() : ''); }

// ---------- home: the History groups ----------
const SORTS = [['profit', 'Most profit'], ['dd', 'Least drawdown'], ['ratio', 'Best net ÷ drawdown'], ['win', 'Highest win %'], ['trades', 'Most trades'], ['newest', 'Newest'], ['years', 'Most positive years']];
const GROUP_NOTE = {
  'Top 10': 'The best test of ten different strategies: 100+ trades, positive in all years but at most one, ranked by net ÷ drawdown.',
  'Best for prop': 'Single strategies with 100+ trades and every year positive, folded by strategy. A prop account fails on drawdown, so the default order is net ÷ drawdown.',
  'Latest tests': 'The 40 newest saved tests, folded by strategy.'
};
function sortKey(t) {
  switch (state.sort) {
    case 'profit': return t.net; case 'dd': return -t.maxDd; case 'ratio': return ratio(t); case 'win': return t.win; case 'trades': return t.trades;
    case 'newest': return t.saved; case 'years': return t.yearsUp * 100 - t.years + ratio(t) / 1000; default: return t.net;
  }
}
const cmp = (a, b) => { const x = sortKey(a), y = sortKey(b); return x < y ? 1 : x > y ? -1 : 0; };
function showHome() {
  const byId = Object.fromEntries(INDEX.tests.map(t => [t.id, t]));
  const g = INDEX.groups.find(x => x.name === state.group) || INDEX.groups[0];
  const items = g.ids.map(id => byId[id]).filter(Boolean);
  const icons = { 'Top 10': '★', 'Best for prop': '◆', 'Latest tests': '◷' };
  const left = INDEX.groups.map(x => {
    const best = Math.max(...x.ids.map(id => byId[id]?.net ?? -1e18));
    return `<div class="g ${x.name === g.name ? 'on' : ''}" data-g="${esc(x.name)}"><span class="${x.name === 'Top 10' ? 'gold' : 'muted'}">${icons[x.name] || '•'}</span><div>${esc(x.name)}<small>best ${money0(best)}</small></div><span class="n">${x.ids.length}</span></div>`;
  }).join('');
  const fams = {}; for (const t of items) (fams[t.family] = fams[t.family] || []).push(t);
  let list = Object.entries(fams).map(([name, tests]) => ({ name, tests: tests.sort(cmp) })).sort((a, b) => cmp(a.tests[0], b.tests[0]));
  const heads = ['Test', 'Saved', 'Trades', 'Net $', 'Win %', 'Max DD', 'Net ÷ DD', 'Years +'];
  const row = (t, indent, label) => `<tr class="click" data-id="${t.id}"><td style="padding-left:${indent}px">${esc(label)}</td><td class="muted">${esc(t.saved)}</td><td>${n0(t.trades)}</td><td class="${tone(t.net)}"><b>${money0(t.net)}</b></td><td>${t.win.toFixed(1)}</td><td class="muted">${money0(-t.maxDd)}</td><td class="${ratio(t) >= 10 ? 'pos' : ''}">${ratio(t).toFixed(1)}</td><td class="${t.yearsUp === t.years ? 'pos' : ''}">${t.yearsUp} / ${t.years}</td></tr>`;
  let body = '';
  for (const f of list) {
    if (f.tests.length === 1 || g.name === 'Top 10') { for (const t of f.tests) body += row(t, 12, g.name === 'Top 10' ? `${f.name}  ·  ${t.label}` : t.label); continue; }
    const open = state.open.has(f.name), t = f.tests[0];
    body += `<tr class="fam" data-fam="${esc(f.name)}"><td>${open ? '▾' : '▸'}  ${esc(f.name)}  <span class="muted">(${f.tests.length} tests)</span></td><td></td><td>${n0(t.trades)}</td><td class="${tone(t.net)}">${money0(t.net)}</td><td>${t.win.toFixed(1)}</td><td class="muted">${money0(-t.maxDd)}</td><td>${ratio(t).toFixed(1)}</td><td>${t.yearsUp} / ${t.years}</td></tr>`;
    if (open) for (const x of f.tests) body += row(x, 34, x.label);
  }
  $app.innerHTML = `<div class="home"><div class="card groups"><div class="muted" style="font-size:11px;font-weight:700;margin:0 0 8px 4px">GROUPS</div>${left}</div>
    <div class="card"><div class="row" style="align-items:center"><div class="grow"><h1>${esc(g.name)}</h1><div class="sub">${esc(GROUP_NOTE[g.name] || '')} ${items.length} tests in ${list.length} strategies. Sizes differ between tests, so net ÷ drawdown compares them fairly.</div></div>
    <label class="muted">Sort by <select id="sort">${SORTS.map(([k, v]) => `<option value="${k}" ${k === state.sort ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div class="tbl" style="margin-top:14px"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></div></div>`;
  $app.querySelectorAll('.g').forEach(el => el.onclick = () => { state.group = el.dataset.g; state.open.clear(); state.sort = state.group === 'Latest tests' ? 'newest' : 'ratio'; showHome(); });
  $app.querySelector('#sort').onchange = e => { state.sort = e.target.value; showHome(); };
  $app.querySelectorAll('tr.fam').forEach(el => el.onclick = () => { const f = el.dataset.fam; state.open.has(f) ? state.open.delete(f) : state.open.add(f); showHome(); });
  $app.querySelectorAll('tr.click').forEach(el => el.onclick = () => go('/t/' + el.dataset.id));
}

// ---------- a test ----------
const TABS = [['journal', 'Journal'], ['chart', 'Chart'], ['equity', 'Equity & Drawdown'], ['trade', 'Trade analysis'], ['time', 'Time analysis'], ['periods', 'Periods'], ['robust', 'Robustness'], ['trades', 'Trades']];
const SUBS = [['stats', 'Statistics'], ['journal', 'Journal'], ['playbooks', 'Playbooks'], ['prop', 'Prop account'], ['overview', 'Run overview']];
async function showTest(id, q) {
  $app.innerHTML = '<div class="loading">Loading the test…</div>';
  let doc = cacheTests[id];
  if (!doc) { try { doc = cacheTests[id] = await getJson(`data/tests/${id}.json`); } catch (e) { $app.innerHTML = '<div class="loading">This test is not published any more.</div>'; return; } }
  const vi = Math.min(+(q.get('v') || 0), doc.views.length - 1), tab = q.get('tab') || 'journal', sub = q.get('sub') || 'stats';
  const v = doc.views[vi];
  const nav = (o) => go('/t/' + id, Object.assign({ v: vi, tab, sub }, o));
  $app.innerHTML = `<div class="row" style="align-items:center"><a class="btn" href="#/">← All tests</a><div class="grow"><h1>${esc(doc.label)}</h1><div class="sub">${esc(doc.family)} · saved ${esc(doc.saved)} · ${esc(v.size)}</div></div>
    <label class="muted">Results for <select id="rf">${doc.views.map((x, i) => `<option value="${i}" ${i === vi ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
    <div class="tabs">${TABS.map(([k, t]) => `<div class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${t}</div>`).join('')}</div><div id="body"></div>`;
  $app.querySelector('#rf').onchange = e => nav({ v: e.target.value });
  $app.querySelectorAll('.tab').forEach(el => el.onclick = () => nav({ tab: el.dataset.t }));
  const body = $app.querySelector('#body');
  ({ journal: () => renderJournal(body, v, sub, s => nav({ sub: s })), chart: () => renderChart(body, v), equity: () => renderEquity(body, v), trade: () => renderTradeAnalysis(body, v),
     time: () => renderTime(body, v), periods: () => renderPeriods(body, v), robust: () => renderRobust(body, v), trades: () => renderTrades(body, v) }[tab] || (() => renderJournal(body, v, sub, s => nav({ sub: s }))))();
}

// ---------- Journal ----------
function kpi(label, value, sub, color, icon, valCls = '') {
  return `<div class="card kpi"><div class="strip" style="background:${color}"></div><div class="lab">${esc(label)}</div><div class="val ${valCls}">${value}</div><div class="s">${sub}</div>
    <div class="badge" style="background:${color}22;color:${color}">${icon}</div></div>`;
}
function renderJournal(el, v, sub, setSub) {
  el.innerHTML = `<div class="pills">${SUBS.map(([k, t]) => `<div class="pill ${k === sub ? 'on' : ''}" data-s="${k}">${t}</div>`).join('')}</div><div id="jb" style="margin-top:12px"></div>`;
  el.querySelectorAll('.pill').forEach(p => p.onclick = () => setSub(p.dataset.s));
  const jb = el.querySelector('#jb');
  ({ stats: journalStats, journal: journalTrades, playbooks: journalPlaybooks, prop: journalProp, overview: runOverview }[sub] || journalStats)(jb, v);
}
function journalStats(el, v) {
  const j = v.journal; const first = j.days.length ? j.days[0][0] : null, last = j.days.length ? j.days[j.days.length - 1][0] : null;
  const span = v.trades.length ? `${n0(v.trades.length)} trades · ${n0(j.activity)} days · ${prettyDay(first)} → ${prettyDay(last)}` : 'no trades';
  const len = j.avgLenMin >= 60 ? (j.avgLenMin / 60).toFixed(1) + 'h' : j.avgLenMin >= 1 ? Math.round(j.avgLenMin) + 'm' : '-';
  const tiles = [['↗', 'Daily PnL', money(j.dailyPnl), tone(j.dailyPnl)], ['🏆', 'Best trade', money(j.best), tone(j.best)], ['↘', 'Worst trade', money(j.worst), tone(j.worst)],
    ['◎', 'Winning days', (j.winningDays ?? 0).toFixed(1) + '%', ''], ['Σ', 'Sharpe ratio', (j.sharpe ?? 0).toFixed(2), ''], ['∿', 'Recovery factor', (j.recovery ?? 0).toFixed(2), ''],
    ['🔥', 'Most wins in a row', j.consWins, ''], ['↘', 'Most losses in a row', j.consLosses, ''], ['▮', 'Trades a day', (j.perDay ?? 0).toFixed(1), ''], ['⧗', 'Avg trade length', len, ''],
    ['▦', 'Activity period', n0(j.activity) + ' days', ''], ['◷', 'Last trade', prettyDay(j.lastDay), ''], ['▤', 'Costs', 'In PnL', '']];
  el.innerHTML = `<div class="card"><div class="row" style="align-items:flex-start"><div class="grow"><div class="muted" style="font-size:12px;font-weight:600">NET PNL</div>
      <div class="hero-net ${tone(j.net)}">${money(j.net)}</div><div class="sub">${span}</div></div>
      <div class="pills" id="eqsw"><div class="pill on" data-m="eq">Equity</div><div class="pill" data-m="daily">Daily PnL</div></div></div><div class="chartbox" id="jeq"></div></div>
    <div class="grid g4">${kpi('Win rate', (j.winRate ?? 0).toFixed(1) + '%', `${j.wins} wins · ${j.losses} losses`, '#8b5cf6', '◎')}
      ${kpi('Profit factor', (j.pf ?? 0).toFixed(2), `${money(j.grossWin)} won · ${money(j.grossLoss)} lost`, '#fbbf24', '◔')}
      ${kpi('Avg win ÷ loss  ' + (j.wl ?? 0).toFixed(2), `<span class="pos">${money(j.avgWin)}</span> &nbsp; <span class="neg">${money(j.avgLoss)}</span>`, 'avg win · avg loss', '#38bdf8', '∿')}
      ${kpi('Max drawdown', money(-j.maxDd), j.maxDdDate ? 'deepest on ' + prettyDay(j.maxDdDate) : '-', '#f87171', '↘', 'neg')}</div>
    <div class="card"><div class="heading"><h2>Advanced Statistics</h2></div><div class="sub">Detailed performance metrics</div>
      <div class="grid g7" style="margin-top:12px">${tiles.map(([i, l, val, c]) => `<div class="tile"><div class="lab"><span class="ic">${i}</span>${l}</div><div class="val ${c}">${esc(val)}</div></div>`).join('')}</div></div>
    <div class="grid g23"><div class="card"><div class="heading"><h2>Playbook Performance</h2></div><div class="sub">Profit/loss by model</div><div class="chartbox small" id="jpb" style="height:300px"></div></div>
      <div class="card" id="jcal"></div></div>`;
  const draw = mode => {
    const box = el.querySelector('#jeq'); disposeIn(box); box.innerHTML = ''; const c = makeChart(box); let cum = 0;
    if (mode === 'daily') { const s = c.addHistogramSeries({ priceLineVisible: false }); s.setData(j.days.map(d => ({ time: d[0], value: d[1], color: d[1] >= 0 ? '#34d399' : '#f87171' }))); }
    else { const s = c.addAreaSeries({ lineColor: '#2dd4bf', topColor: 'rgba(45,212,191,.35)', bottomColor: 'rgba(45,212,191,0)', lineWidth: 2, priceLineVisible: false }); s.setData(j.days.map(d => ({ time: d[0], value: Math.round((cum += d[1]) * 100) / 100 }))); }
    c.timeScale().fitContent();
  };
  draw('eq');
  el.querySelectorAll('#eqsw .pill').forEach(p => p.onclick = () => { el.querySelectorAll('#eqsw .pill').forEach(x => x.classList.toggle('on', x === p)); draw(p.dataset.m); });
  playbookBars(el.querySelector('#jpb'), j.bySymbol);
  calendar(el.querySelector('#jcal'), j.days);
}
function playbookBars(el, rows) {
  if (!rows.length) { el.innerHTML = '<div class="muted">No trades.</div>'; return; }
  const max = Math.max(1, ...rows.map(r => Math.abs(r[1]))), h = 240;
  el.innerHTML = `<svg width="100%" height="${h + 40}" viewBox="0 0 ${rows.length * 100} ${h + 40}" preserveAspectRatio="none">` + rows.map((r, i) => {
    const bh = Math.max(2, Math.abs(r[1]) / max * (h - 20)), y = r[1] >= 0 ? h - bh : h - 2;
    return `<rect x="${i * 100 + 22}" y="${y}" width="56" height="${bh}" rx="4" fill="${r[1] >= 0 ? '#8b5cf6' : '#f87171'}"><title>${esc(r[0])}: ${money0(r[1])}</title></rect>`;
  }).join('') + `</svg><div class="row" style="justify-content:space-around">${rows.map(r => `<span class="muted" style="font-size:11px">${esc(r[0])} <b class="${tone(r[1])}">${money0(r[1])}</b></span>`).join('')}</div>`;
}
function calendar(el, days) {
  const map = Object.fromEntries(days.map(d => [d[0], d]));
  let cur = days.length ? new Date(days[days.length - 1][0] + 'T12:00:00Z') : new Date();
  const drawMonth = () => {
    const y = cur.getUTCFullYear(), m = cur.getUTCMonth(); const first = new Date(Date.UTC(y, m, 1)); const startOff = (first.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(y, m, 1 - startOff)); const last = new Date(Date.UTC(y, m + 1, 0)); const weeks = Math.ceil((startOff + last.getUTCDate()) / 7);
    let cells = '<div></div>' + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => `<div class="hd">${d}</div>`).join('');
    for (let w = 0; w < weeks; w++) {
      let wk = 0, wd = 0, row = '';
      for (let c = 0; c < 7; c++) {
        const d = new Date(start.getTime() + (w * 7 + c) * 864e5); const key = d.toISOString().slice(0, 10); const x = map[key];
        if (x) { wk += x[1]; wd++; }
        row += `<div class="day ${x ? (x[1] >= 0 ? 'up' : 'down') : ''}" style="${d.getUTCMonth() !== m ? 'opacity:.45' : ''}"><span class="num">${d.getUTCDate()}</span>${x ? `<div class="p">${money(x[1])}</div><div class="t">${x[2]} trade${x[2] === 1 ? '' : 's'} · ${(100 * x[3] / x[2]).toFixed(0)}%</div>` : ''}</div>`;
      }
      cells += `<div class="wk">Week<b class="${tone(wk)}">${money(wk)}</b>${wd} day${wd === 1 ? '' : 's'}</div>` + row;
    }
    el.innerHTML = `<div class="row" style="align-items:center"><div class="grow"><div class="heading"><h2>Trading Calendar</h2></div><div class="sub">Daily performance overview</div></div>
      <button class="btn" id="cp">‹</button><b style="min-width:140px;text-align:center">${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b><button class="btn" id="cn">›</button><button class="btn" id="cl">Last month</button></div><div class="cal">${cells}</div>`;
    el.querySelector('#cp').onclick = () => { cur = new Date(Date.UTC(y, m - 1, 15)); drawMonth(); };
    el.querySelector('#cn').onclick = () => { cur = new Date(Date.UTC(y, m + 1, 15)); drawMonth(); };
    el.querySelector('#cl').onclick = () => { cur = days.length ? new Date(days[days.length - 1][0] + 'T12:00:00Z') : new Date(); drawMonth(); };
  };
  drawMonth();
}
function journalTrades(el, v) {
  const rows = v.trades.slice().reverse().map(t => [nyText(t[0]), nyText(t[1]), v.strategies[t[15]] || '', t[3] > 0 ? 'Long' : 'Short', String(t[14]), String(t[4]), String(t[7]), money(t[10])]);
  pagedTable(el, 'Trades (newest first)', ['Open (NY)', 'Close (NY)', 'Playbook', 'Side', 'Qty', 'Entry', 'Exit', 'PnL'], rows, [7]);
}
function journalPlaybooks(el, v) {
  el.innerHTML = `<div class="card"><div class="heading"><h2>Playbooks</h2></div><div class="sub">Each model of this run</div>` +
    table('', ['Playbook', 'Trades', 'A week', 'Win rate', 'Avg R', 'Profit factor', 'Net PnL', 'Max drawdown'],
      v.journal.playbooks.map(p => [p.name, n0(p.trades), (p.week ?? 0).toFixed(1), (p.win ?? 0).toFixed(1) + '%', r3(p.avgR), (p.pf ?? 0).toFixed(2), money(p.net), money(p.maxDd)]), [4, 6]) + '</div>';
}
// ---------- Prop account simulator: the same rules and code as BroViewer (Bro.Backtest/PropAccount.cs Run); change both ----------
const PROP = { account: 'Topstep 150k', evalTrail: '', fundedTrail: '', evalCons: '', fundedCons: '', consistency: false, keep: 4000, evalTimes: 5, fundedTimes: 8, dailyStop: 1000, discount: 0, months: 24, start: '' };
const SESSIONS_A_MONTH = 21;
function propRun(A, ses, byDay, start, end, c) {
  const topstep = A.kind === 'Topstep';
  const evalTrail = c.evalTrail || A.evalTrail, fundedTrail = c.fundedTrail || A.fundedTrail;
  const evalShare = c.evalCons !== '' ? +c.evalCons : A.evalCons;
  const fundedShare = c.fundedCons !== '' ? +c.fundedCons : (topstep && c.consistency ? 0.40 : A.fundedCons);
  const evalFee = A.evalFee * (1 - c.discount), unit = c.micro ? 10 : 1;
  const lockEval = topstep ? 0 : Infinity, lockFunded = topstep ? 0 : 100;
  const caps = A.caps.map(x => x == null ? Infinity : x);
  let paid = 0, got = 0, fee = evalFee, bal = 0, peak = 0, floor = -A.limit, best = 0, cycle = 0, cycleBest = 0, accountPaid = 0;
  let failedC = 0, failedF = 0, passed = 0, n = 0, wins = 0, tradedDays = 0, q = 0, pays = 0, d = start, first = null;
  let funded = false, after = false, full = false;
  const ev = [[ses[start], 'Start', -evalFee, null]];
  const reset = () => { bal = peak = 0; floor = -A.limit; };
  const newEval = (day, k) => { fee += evalFee; ev.push([day, k, -evalFee, null]); funded = false; reset(); best = 0; n = 0; };
  const raise = (high, lockAt) => { peak = Math.max(peak, high); floor = Math.min(Math.max(floor, peak - A.limit), lockAt); };
  while (d < end) {
    const open = bal; let dead = false;
    const trail = funded ? fundedTrail : evalTrail, lockAt = funded ? lockFunded : lockEval;
    const times = funded ? c.fundedTimes : c.evalTimes; let limit = funded ? c.fundedCap : c.evalCap, dll = 0;
    if (!funded) { if (A.evalMinis > 0) limit = Math.min(limit, A.evalMinis * unit); dll = A.evalDll; }
    else if (A.tiers) { let tier = A.tiers[0]; for (const x of A.tiers) if (bal >= x[0]) tier = x; limit = Math.min(limit, tier[1] * unit); dll = tier[2]; }
    else if (A.fundedMinis > 0) limit = Math.min(limit, Math.max(1, (full ? A.fundedMinis : Math.floor(A.fundedMinis / 2)) * unit));
    limit = Math.max(1, limit);
    for (const t of byDay[d]) {
      const k = Math.min(t[2] * times, limit) / t[2], p = t[0] * k, a = t[1] * k, f = t[3] * k;
      if (trail === 'Intraday' && p <= 0) raise(bal + f, lockAt);
      const low = bal - a;
      if (dll > 0 && low <= open - dll && open - dll > floor) { bal = open - dll; break; }
      if (low <= floor) { dead = true; break; }
      if (trail === 'Intraday' && p > 0) raise(bal + f, lockAt);
      if (bal + p <= floor) { dead = true; break; }
      bal += p;
      if (c.dailyStop > 0 && bal - open <= -c.dailyStop) break;
    }
    const day = bal - open, today = ses[d], traded = byDay[d].length > 0;
    d++;
    if (!funded) {
      n++;
      if (dead) { failedC++; newEval(today, 'CombineFailed'); continue; }
      if (A.monthly && n % SESSIONS_A_MONTH === 0) { fee += evalFee; ev.push([today, 'MonthlyFee', -evalFee, null]); }
      best = Math.max(best, day); raise(bal, lockAt);
      if (bal >= (evalShare > 0 ? Math.max(A.target, best / evalShare) : A.target)) {
        passed++; fee += A.activation; ev.push([today, 'CombinePassed', -A.activation, null]);
        funded = true; after = false; full = false; reset(); wins = tradedDays = q = pays = 0; cycle = cycleBest = accountPaid = 0;
      } else if (A.evalSessions > 0 && n >= A.evalSessions) { failedC++; newEval(today, 'EvalExpired'); }
      continue;
    }
    if (dead) { failedF++; newEval(today, 'FundedFailed'); continue; }
    cycle += day; cycleBest = Math.max(cycleBest, day);
    if (day >= 150) wins++;
    if (traded) tradedDays++;
    if (day > 0 && day >= A.minDay) q++;
    if (!after || !topstep) raise(bal, lockAt);
    if (bal > A.limit + 100) full = true;
    let amount = 0;
    if (topstep) {
      const ok = fundedShare > 0 ? tradedDays >= 3 && cycle > 0 && cycleBest <= fundedShare * cycle : wins >= 5 && (!after || cycle > 0);
      if (ok && bal > 0) amount = Math.min(fundedShare > 0 ? A.consistencyCap : caps[0], Math.min(0.5 * bal, bal - c.keep));
    } else if (A.kind === 'Apex') {
      const ok = q >= A.minDays && (fundedShare <= 0 || (cycle > 0 && cycleBest < fundedShare * cycle));
      if (ok) amount = Math.min(caps[Math.min(pays, caps.length - 1)], bal - (A.limit + 100));
    } else {
      const net = pays < 3 ? A.limit + 100 : 100;
      const ok = tradedDays >= A.minDays && q >= 5 && (fundedShare <= 0 || (bal > 0 && cycleBest <= fundedShare * bal)) && bal >= net;
      if (ok) amount = Math.min(caps[Math.min(pays, caps.length - 1)], bal - (pays < 3 ? net - A.minPayout : net));
    }
    if (amount >= A.minPayout) {
      const free = Math.max(0, 25000 - accountPaid);
      const mine = A.kind === 'ApexLegacy' ? Math.min(amount, free) + 0.9 * Math.max(0, amount - free) : amount * A.split;
      bal -= amount; paid += amount; got += mine; accountPaid += amount; pays++;
      ev.push([today, 'Payout', mine, bal]);
      if (topstep) floor = 0;
      after = true; wins = tradedDays = q = 0; cycle = cycleBest = 0;
      if (first == null) first = d - start;
      if (A.maxPayouts > 0 && pays >= A.maxPayouts) { ev.push([today, 'FundedClosed', 0, bal]); newEval(today, 'Start'); }
    }
  }
  return { paid, fees: fee, cash: got - fee, combineFailed: failedC, fundedFailed: failedF, passed, first, events: ev, payouts: ev.filter(e => e[1] === 'Payout').length };
}
function propInput(v) {
  if (v._prop) return v._prop;
  const days = v.trades.map(t => t[16]); if (!days.length) return null;
  const firstDay = days.reduce((a, b) => a < b ? a : b), lastDay = days.reduce((a, b) => a > b ? a : b);
  const ses = [];
  for (let d = new Date(firstDay + 'T12:00:00Z'); d <= new Date(lastDay + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) ses.push(d.toISOString().slice(0, 10)); }
  const at = new Map(ses.map((x, i) => [x, i])), byDay = ses.map(() => []);
  for (const t of [...v.trades].sort((a, b) => a[0] - b[0])) { const i = at.get(t[16]); if (i != null) byDay[i].push([t[10], t[17] ?? 0, t[14], t[18] ?? 0]); }
  return (v._prop = { ses, byDay });
}
function propSettings(v) { return { ...PROP, micro: v.micro, evalCap: v.micro ? 20 : 2, fundedCap: v.micro ? 10 : 1 }; }
function journalProp(el, v) {
  const rules = (INDEX && INDEX.propRules) || [];
  const inp = rules.length ? propInput(v) : null;
  if (!inp) { el.innerHTML = '<div class="card muted">' + (rules.length ? 'This run has no trades.' : 'Prop rules are missing: publish again from BroViewer.') + '</div>'; return; }
  const A = rules.find(r => r.key === PROP.account) || rules[2];
  const topstep = A.kind === 'Topstep', word = topstep ? 'Combine' : 'Evaluation';
  const c = propSettings(v);
  const { ses, byDay } = inp, span = PROP.months * SESSIONS_A_MONTH;
  const startDay = PROP.start || ses[Math.max(0, ses.length - span)];
  let s = 0; while (s < ses.length - 1 && ses[s] < startDay) s++;
  const e = Math.min(ses.length, s + span), r = propRun(A, ses, byDay, s, e, c), months = (e - s) / SESSIONS_A_MONTH;
  const all = [];
  for (let b = 0; b + span <= ses.length; b += 14) { const x = propRun(A, ses, byDay, b, b + span, c); all.push([x.cash / PROP.months, x.combineFailed + x.fundedFailed, x.first]); }
  let sp = '';
  if (all.length) {
    const ms = all.map(x => x[0]).sort((a, b) => a - b), fp = all.filter(x => x[2] != null).map(x => x[2]).sort((a, b) => a - b);
    sp = `These settings, over ${all.length} start dates: ${money0(ms[ms.length >> 1])} a month in the middle, ${money0(ms[0])} at worst, ${money0(ms[ms.length - 1])} at best. ` +
      (fp.length ? `First payout after about ${(fp[fp.length >> 1] / SESSIONS_A_MONTH).toFixed(1)} months. ` : 'No payout. ') +
      `${(all.reduce((t, x) => t + x[1], 0) / all.length).toFixed(1)} failed accounts in ${PROP.months} months. The cards below are only the start date you picked.`;
  }
  const trailName = t => t === 'Eod' ? 'EOD' : 'Intraday', pctName = x => x <= 0 ? 'None' : Math.round(x * 100) + ' %';
  const firmFunded = topstep && PROP.consistency ? 0.40 : A.fundedCons;
  const opt = (val, text, cur) => `<option value="${esc(val)}"${String(val) === String(cur) ? ' selected' : ''}>${esc(text)}</option>`;
  const sel = (key, label, options, w) => `<label class="pf"><span>${label}</span><select data-k="${key}" style="min-width:${w}px">${options.join('')}</select></label>`;
  const starts = [...new Set([ses[0], ...ses.filter((d, i) => i + span <= ses.length && d.slice(5, 7) === '01' && (i === 0 || ses[i - 1].slice(5, 7) === '12')), ses[Math.max(0, ses.length - span)]])].sort();
  const shareOpts = (key, firm) => [opt('', `Firm rule (${pctName(firm)})`, PROP[key]), ...[[0, 'None'], [0.3, '30 %'], [0.4, '40 %'], [0.5, '50 %'], [0.55, '55 %']].map(([x, t]) => opt(String(x), t, PROP[key]))];
  const trailOpts = (key, firm) => [opt('', `Firm rule (${trailName(firm)})`, PROP[key]), opt('Eod', 'EOD', PROP[key]), opt('Intraday', 'Intraday', PROP[key])];
  const controls = [
    sel('start', 'Start', starts.map(d => opt(d, prettyDay(d), startDay)), 120),
    sel('months', 'Length', [6, 12, 24, 36].map(m => opt(m, m + ' months', PROP.months)), 100),
    sel('account', 'Account', ['Topstep', 'Apex'].map(f => `<optgroup label="${f}">` + rules.filter(x => x.firm === f).map(x => opt(x.key, x.key, A.key)).join('') + '</optgroup>'), 170),
    sel('evalTimes', 'Evaluation size', [1, 3, 5, 8, 10].map(x => opt(x, x + ' ×', PROP.evalTimes)), 80),
    sel('fundedTimes', 'Funded size', [1, 2, 3, 5, 8].map(x => opt(x, x + ' ×', PROP.fundedTimes)), 80),
    sel('evalTrail', 'Evaluation drawdown', trailOpts('evalTrail', A.evalTrail), 130),
    sel('fundedTrail', 'Funded drawdown', trailOpts('fundedTrail', A.fundedTrail), 130),
    sel('evalCons', 'Evaluation consistency', shareOpts('evalCons', A.evalCons), 130),
    sel('fundedCons', 'Funded consistency', shareOpts('fundedCons', firmFunded), 130),
    sel('discount', 'Price paid', [[0, 'List price'], [0.5, '50 % off'], [0.8, '80 % off'], [0.9, '90 % off']].map(([x, t]) => opt(x, t, PROP.discount)), 110),
    ...(topstep ? [sel('consistency', 'Payout path', [opt('0', 'Standard', PROP.consistency ? 1 : 0), opt('1', 'Consistency', PROP.consistency ? 1 : 0)], 110),
      sel('keep', 'Keep after payout', [2000, 4000].map(x => opt(x, money0(x), PROP.keep)), 100)] : []),
    sel('dailyStop', 'Own daily stop', [[0, 'None'], [1000, '$1,000']].map(([x, t]) => opt(x, t, PROP.dailyStop)), 100)];
  const byYear = {};
  for (const x of r.events) { const y = x[0].slice(0, 4), m = +x[0].slice(5, 7); (byYear[y] = byYear[y] || Array(13).fill(0))[m] += x[2]; }
  const monthsN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const kinds = { Start: word + ' started', CombineFailed: word + ' failed', CombinePassed: word + ' passed', Payout: 'Payout', FundedFailed: 'Funded failed', EvalExpired: word + ' expired (30 days)', FundedClosed: `Funded closed after ${A.maxPayouts} payouts` };
  const firstPay = r.events.find(x => x[1] === 'Payout'), expired = r.events.filter(x => x[1] === 'EvalExpired').length;
  const split = A.kind === 'ApexLegacy' ? '100 % of the first $25k, then 90 %' : topstep ? '90 %' : '100 %';
  const rule = `${A.key}: target ${money0(A.target)}, loss limit ${money0(A.limit)} (${trailName(c.evalTrail || A.evalTrail)} in the ${word.toLowerCase()}, ${trailName(c.fundedTrail || A.fundedTrail)} funded)` +
    (A.evalDll ? `, daily loss limit ${money0(A.evalDll)} in the evaluation` : '') + `, ${money0(A.evalFee * (1 - PROP.discount))} ${A.monthly ? 'a month' : 'once'}${A.evalSessions ? ' (30 days to pass)' : ''}, activation ${money0(A.activation)}` +
    (A.maxPayouts ? `, at most ${A.maxPayouts} payouts` : '') + `. Sizes: evaluation ${PROP.evalTimes} × (at most ${v.micro ? '20 micros' : '2 minis'}), funded ${PROP.fundedTimes} × (at most ${v.micro ? '10 micros' : '1 mini'}), within the firm's contract limits.`;
  el.innerHTML = `<div class="card"><div class="heading"><h2>Prop account</h2></div><div class="sub">This run's trades through a Topstep or Apex account: fees, target, loss limit (EOD or intraday), consistency, payouts. Rules read: Topstep 2026-11-07, Apex 2026-11-08. Change the settings to try another account.</div>
      <div class="propctl">${controls.join('')}</div><div class="note">${esc(rule)}</div></div>
    ${sp ? `<div class="card">${esc(sp)}</div>` : ''}
    <div class="grid g5">${kpi('Net cash', money0(r.cash), money0(r.cash / Math.max(1, months)) + ' a month', '#2dd4bf', '▣', tone(r.cash))}${kpi('Payouts', r.payouts, money0(r.paid) + ' gross, ' + split + ' yours', '#8b5cf6', '◉')}
      ${kpi('First payout', firstPay ? prettyDay(firstPay[0]) : 'None', r.first != null ? `about ${(r.first / SESSIONS_A_MONTH).toFixed(1)} months in` : 'in this range', '#38bdf8', '▦')}${kpi('Fees', money0(r.fees), word + 's, resets, activation', '#fbbf24', '▤')}
      ${kpi('Failed accounts', r.combineFailed + r.fundedFailed, `${r.combineFailed} ${word}${expired ? ` (${expired} expired)` : ''}, ${r.fundedFailed} funded, ${r.passed} passed`, '#f87171', '↘', r.combineFailed + r.fundedFailed > 0 ? 'neg' : '')}</div>
    <div class="card"><div class="heading"><h2>Cash by month</h2></div><div class="sub">Payouts after the split, less fees</div>${table('', ['Year', ...monthsN, 'Total'], Object.entries(byYear).map(([y, a]) => [y, ...a.slice(1).map(x => x ? money0(x) : ''), money0(a.reduce((t, x) => t + x, 0))]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])}</div>
    <div class="card"><div class="heading"><h2>Account events</h2></div><div class="sub">Newest first</div>${table('', ['Date', 'Event', 'Cash', 'Balance left'], r.events.filter(x => x[1] !== 'MonthlyFee').reverse().map(x => [x[0], kinds[x[1]] || x[1], money0(x[2]), x[3] == null ? '' : money0(x[3])]), [2])}</div>
    <div class="note">Results change with the start date. Intraday trailing uses each trade's best open profit (a winner reaches its worst price first, a loser its best first). Not included: a call-up to Live, news limits, tax, Apex's inactivity rule, the Legacy 30 % open-loss and 5:1 rules. Apex sells with coupons: set Price paid.</div>`;
  el.querySelectorAll('select[data-k]').forEach(x => x.addEventListener('change', () => {
    const k = x.dataset.k, val = x.value;
    if (['account', 'start', 'evalTrail', 'fundedTrail', 'evalCons', 'fundedCons'].includes(k)) PROP[k] = val;
    else if (k === 'consistency') { PROP.consistency = val === '1'; PROP.fundedCons = ''; }
    else PROP[k] = +val;
    if (k === 'months') PROP.start = '';
    journalProp(el, v);
  }));
}
function runOverview(el, v) {
  const a = v.all, o = v.oos, cap = v.capital;
  const m = x => (x < 0 ? '-' : '') + Math.abs(Math.round(x)).toLocaleString('en-US');
  const cards = [['FINAL BALANCE', m(cap + a.net), ((a.net / cap) * 100).toFixed(1) + ' %', tone(a.net)], ['NET PROFIT', m(a.net), `${(a.totalR > 0 ? '+' : '') + a.totalR.toFixed(1)} R · ${esc(v.size)}`, tone(a.net)],
    ['MAX DRAWDOWN', '-' + m(a.maxDd), `${a.maxDdR.toFixed(1)} R · ${((a.maxDd / cap) * 100).toFixed(1)} %`, 'neg'], ['PROFIT FACTOR', a.pf == null ? '∞' : a.pf.toFixed(2), `avg win ${(a.avgWinR ?? 0).toFixed(2)}R / loss ${(a.avgLossR ?? 0).toFixed(2)}R`, a.pf >= 1 ? 'pos' : 'neg'],
    ['WIN RATE', (a.winRate * 100).toFixed(1) + ' %', `${a.wins} / ${a.trades}`, ''], ['TRADES', n0(a.trades), `${(a.perDay ?? 0).toFixed(1)} / day · streak ${a.streak} losses`, ''],
    ['EXPECTANCY', r3(a.avgR) + ' R', `t-stat ${(a.t ?? 0).toFixed(2)}`, tone(a.avgR)], ['OUT-OF-SAMPLE', r3(o.avgR) + ' R', `${o.trades} trades · from ${prettyDay(v.split)}`, tone(o.avgR)]];
  const verdict = a.t >= 2 && o.avgR > 0 ? ['An edge that holds out-of-sample. Check it per year once more data is in.', 'pos'] : a.avgR > 0 ? ['Positive, but not proven (t-stat under 2 or out-of-sample not positive).', 'gold'] : ['No edge with these parameters.', 'neg'];
  const money = v.money.map(r => r.trades ? [r.label, String(r.trades), money0(r.net), money0(r.grossWin), money0(r.grossLoss), money0(r.fees), money0(r.avg), money0(r.avgWin), money0(r.avgLoss), money0(r.best), money0(r.worst), money0(r.maxDd), money0(r.perDay)] : [r.label, '0', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']);
  el.innerHTML = `<div class="grid g8">${cards.map(c => `<div class="card kpi mini"><div class="lab">${c[0]}</div><div class="val ${c[3]}">${c[1]}</div><div class="s">${c[2]}</div></div>`).join('')}</div>
    ${table(`${v.name} on ${v.root}: ${v.days} days`, SUM_HEADS, [sumRow('All', a), sumRow('In-sample', v.ins), sumRow(`Out-of-sample (from ${v.split})`, o)], [3, 4, 7])}
    ${table(`Profit & loss in dollars (${v.size}, after fees)`, ['', 'Trades', 'Net', 'Gross profit', 'Gross loss', 'Fees', 'Avg trade', 'Avg win', 'Avg loss', 'Best', 'Worst', 'Max DD', 'Per day'], money, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])}
    <div class="verdict ${verdict[1]}">${verdict[0]}</div>
    <div class="note">Average win ${(a.avgWinR > 0 ? '+' : '') + (a.avgWinR ?? 0).toFixed(2)}R, average loss ${(a.avgLossR ?? 0).toFixed(2)}R, MAE ${(a.mae ?? 0).toFixed(2)}R, MFE ${(a.mfe ?? 0).toFixed(2)}R, ${Math.round(a.bars ?? 0)} bars per trade, positive days ${pct(a.posDays)}, positive weeks ${a.posWeeks}/${a.weeks}, Sharpe (daily) ${(a.sharpe ?? 0).toFixed(2)}.</div>
    ${v.runs ? table('Strategies of this run (choose one under "Results for" for its details)', ['Strategy', ...SUM_HEADS.slice(1), 'OOS n', 'OOS avg R'], v.runs.slice().sort((x, y) => y.all.avgR - x.all.avgR).map(r => [...sumRow(r.name, r.all), String(r.oosTrades), r3(r.oosAvgR)]).concat([[...sumRow('Overall', a), String(o.trades), r3(o.avgR)]]), [3, 4, 7, 10]) : ''}`;
}

// ---------- Chart: NQ 5-minute candles of a trade's day, the trades drawn on it ----------
const candleCache = {};
async function renderChart(el, v) {
  if (v.root !== 'NQ') { el.innerHTML = '<div class="card muted">The chart is published for NQ only.</div>'; return; }
  if (!v.trades.length) { el.innerHTML = '<div class="card muted">No trades.</div>'; return; }
  let k = v.trades.length - 1;
  el.innerHTML = `<div class="card"><div class="chartbar"><button class="btn" id="tp">‹ Previous trade</button><select id="tsel"></select><button class="btn" id="tn">Next trade ›</button><span class="muted" id="tinfo"></span></div>
    <div class="chartbox tall" id="cbox"></div><div class="note">NQ, 5-minute candles in New York time (raw contract prices, like the trades). Arrows: entries; circles: exits; dashed: the selected trade's stop and target.</div></div>`;
  const sel = el.querySelector('#tsel');
  sel.innerHTML = v.trades.map((t, i) => `<option value="${i}">#${i + 1} · ${nyText(t[0])} · ${t[3] > 0 ? 'Long' : 'Short'} · ${(t[9] > 0 ? '+' : '') + t[9].toFixed(2)}R</option>`).join('');
  const box = el.querySelector('#cbox'); const chart = makeChart(box);
  const candles = chart.addCandlestickSeries({ upColor: '#34d399', downColor: '#f87171', borderVisible: false, wickUpColor: '#34d399', wickDownColor: '#f87171', priceLineVisible: false });
  let lines = [];
  async function show(i) {
    k = Math.max(0, Math.min(v.trades.length - 1, i)); sel.value = k; const t = v.trades[k]; const day = t[16];
    let rows = candleCache[day];
    if (!rows) { try { rows = candleCache[day] = await getJson(`data/candles/${day.slice(0, 4)}/NQ_${day}.json`); } catch (e) { rows = []; } }
    candles.setData(rows.map(r => ({ time: nySec(r[0] * 1000), open: r[1], high: r[2], low: r[3], close: r[4] })));
    const same = v.trades.filter(x => x[16] === day);
    const marks = [];
    for (const x of same) {
      const long = x[3] > 0, win = x[9] > 0;
      marks.push({ time: nySec(Math.floor(x[0] / 300000) * 300000), position: long ? 'belowBar' : 'aboveBar', color: long ? '#38bdf8' : '#fbbf24', shape: long ? 'arrowUp' : 'arrowDown', text: x === t ? (long ? 'Long' : 'Short') : '' });
      marks.push({ time: nySec(Math.floor(x[1] / 300000) * 300000), position: long ? 'aboveBar' : 'belowBar', color: win ? '#34d399' : '#f87171', shape: 'circle', text: x === t ? (x[9] > 0 ? '+' : '') + x[9].toFixed(2) + 'R' : '' });
    }
    marks.sort((a, b) => a.time - b.time); candles.setMarkers(marks);
    for (const l of lines) candles.removePriceLine(l); lines = [];
    lines.push(candles.createPriceLine({ price: t[4], color: '#e6ebf3', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'entry' }));
    if (t[5]) lines.push(candles.createPriceLine({ price: t[5], color: '#f87171', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'stop' }));
    if (t[6]) lines.push(candles.createPriceLine({ price: t[6], color: '#34d399', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'target' }));
    lines.push(candles.createPriceLine({ price: t[7], color: t[9] > 0 ? '#34d399' : '#f87171', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'exit' }));
    const from = nySec(t[0]) - 3 * 3600, to = nySec(t[1]) + 3 * 3600;
    chart.timeScale().setVisibleRange({ from, to });
    el.querySelector('#tinfo').textContent = `${v.strategies[t[15]] || ''} · entry ${t[4]} · exit ${t[7]} (${t[8]}) · ${money(t[10])} · ${same.length} trade${same.length === 1 ? '' : 's'} that day`;
    if (!rows.length) el.querySelector('#tinfo').textContent += ' · no candles for this day';
  }
  el.querySelector('#tp').onclick = () => show(k - 1); el.querySelector('#tn').onclick = () => show(k + 1); sel.onchange = () => show(+sel.value);
  show(k);
}

// ---------- Equity & Drawdown ----------
function renderEquity(el, v) {
  el.innerHTML = `<div class="card"><div class="heading"><h2>Equity</h2></div><div class="sub">Starting capital ${money0(v.capital)}, each trade at its exit (${esc(v.size)})</div><div class="chartbox" id="eq" style="height:420px"></div>
    <div class="heading" style="margin-top:18px"><h2>Drawdown</h2></div><div class="chartbox" id="dd" style="height:200px"></div></div>`;
  const tr = v.trades.slice().sort((a, b) => a[1] - b[1]);
  let eq = v.capital, peak = eq, last = 0; const e = [], d = [];
  for (const t of tr) { eq += t[10]; peak = Math.max(peak, eq); let s = nySec(t[1]); if (s <= last) s = last + 1; last = s; e.push({ time: s, value: Math.round(eq * 100) / 100 }); d.push({ time: s, value: Math.round((eq - peak) * 100) / 100 }); }
  const c1 = makeChart(el.querySelector('#eq')); c1.addAreaSeries({ lineColor: '#2dd4bf', topColor: 'rgba(45,212,191,.3)', bottomColor: 'rgba(45,212,191,0)', lineWidth: 2, priceLineVisible: false }).setData(e); c1.timeScale().fitContent();
  const c2 = makeChart(el.querySelector('#dd')); c2.addAreaSeries({ lineColor: '#f87171', topColor: 'rgba(248,113,113,0)', bottomColor: 'rgba(248,113,113,.45)', lineWidth: 1, priceLineVisible: false, invertFilledArea: true }).setData(d); c2.timeScale().fitContent();
}

// ---------- analysis tabs ----------
function renderTradeAnalysis(el, v) { el.innerHTML = `<div class="wrapgrid"><div>${sumTable('By exit', v.byExit)}</div><div>${sumTable('By side', v.bySide)}</div></div>`; }
function renderTime(el, v) { el.innerHTML = `<div class="wrapgrid"><div>${sumTable('By hour (New York)', v.byHour.map(r => ({ key: r.key + ':00', s: r.s })))}</div><div>${sumTable('By session', v.bySession)}</div><div>${sumTable('By weekday', v.byWeekday)}</div></div>`; }
function renderPeriods(el, v) { el.innerHTML = `<div class="wrapgrid"><div>${sumTable('By month', v.byMonth)}</div><div>${sumTable('By week', v.byWeek)}</div></div>`; }
function renderRobust(el, v) { el.innerHTML = sumTable('In-sample vs out-of-sample', [{ key: 'In-sample', s: v.ins }, { key: 'Out-of-sample', s: v.oos }]) + `<div class="note">Out-of-sample from ${v.split}.</div>`; }
function renderTrades(el, v) {
  const rows = v.trades.map((t, i) => [String(i + 1), nyText(t[2] || t[0]), t[3] > 0 ? 'Long' : 'Short', String(t[4]), String(t[5]), nyText(t[1]), String(t[7]), t[8], (t[9] > 0 ? '+' : '') + t[9].toFixed(2), t[11].toFixed(2), t[12].toFixed(2), String(t[13]), money(t[10])]);
  pagedTable(el, `${n0(rows.length)} trades`, ['#', 'Signal (NY)', 'Side', 'Entry', 'Stop', 'Exit (NY)', 'Exit', 'Reason', 'R', 'MAE', 'MFE', 'Bars', 'PnL'], rows, [8, 12]);
}
function pagedTable(el, title, heads, rows, signCols) {
  const per = 250; let page = 0; const pages = Math.max(1, Math.ceil(rows.length / per));
  const draw = () => {
    el.innerHTML = `<div class="card"><div class="row" style="align-items:center"><div class="tt grow">${esc(title)}</div><div class="pager"><button class="btn" id="pp">‹</button><span class="muted">page ${page + 1} / ${pages}</span><button class="btn" id="pn">›</button></div></div>` +
      table('', heads, rows.slice(page * per, page * per + per), signCols) + '</div>';
    el.querySelector('#pp').onclick = () => { if (page > 0) { page--; draw(); } };
    el.querySelector('#pn').onclick = () => { if (page < pages - 1) { page++; draw(); } };
  };
  draw();
}
