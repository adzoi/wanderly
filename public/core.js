// Shared helpers: DOM, API, currency, listing cards, availability calendar, dialogs.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $('#app');
const state = { user: null, meta: null, rates: null };
const ICON = { 'Tours & Excursions': '🧭', 'Food & Drink': '🍷', Rentals: '🚲', 'Adventure & Outdoors': '🏔️', 'Culture & Workshops': '🎨', 'Transport & Transfers': '🚐', Wellness: '🧖', Accommodation: '🏡' };
const catName = (c) => t('cat.' + c);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg) => { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600); };

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'X-Lang': lang, ...(opts.body !== undefined && !opts.raw ? { 'Content-Type': 'application/json' } : opts.headers) },
    body: opts.raw ? opts.body : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || t('errGeneric')), { status: res.status });
  return data;
}

// ---------- currency ----------
const AUTO_CUR = { ka: 'GEL', en: 'USD', ru: 'RUB', tr: 'TRY' };
let curPref = (() => { try { return localStorage.getItem('cur'); } catch { return null; } })();
const displayCur = () => (curPref && state.rates?.currencies.includes(curPref) ? curPref : AUTO_CUR[lang]);
const setCur = (c) => { curPref = c; try { localStorage.setItem('cur', c); } catch {} };
const convert = (amount, from, to) => (from === to || !state.rates ? amount : (amount / state.rates.rates[from]) * state.rates.rates[to]);
const fmtMoney = (amount, cur) => new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, maximumFractionDigits: amount >= 100 ? 0 : 2, minimumFractionDigits: 0 }).format(amount);
// Price in the visitor's currency; "≈" marks a converted amount.
function money(l) {
  const to = displayCur();
  return to === l.currency ? fmtMoney(l.price, to) : '≈ ' + fmtMoney(convert(l.price, l.currency, to), to);
}
const priceLine = (l) => `<b>${money(l)}</b> <span class="meta">/ ${t('unit.' + l.price_unit)}</span>`;

// ---------- small bits ----------
const stars = (r, n) => r ? `<span class="stars">★ ${r}</span> <span class="meta">(${n})</span>` : `<span class="meta">${t('new')}</span>`;
const monthShort = (m) => new Intl.DateTimeFormat(locale(), { month: 'short' }).format(new Date(2024, m - 1, 1));
const monthLong = (m) => new Intl.DateTimeFormat(locale(), { month: 'long' }).format(new Date(2024, m - 1, 1));
const weekdayShort = (i) => new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(new Date(2024, 0, 1 + i)); // 2024-01-01 is a Monday
const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(locale(), opts).format(new Date(iso + 'T00:00:00'));
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function badges(l) {
  const out = [];
  if (l.season_from && l.season_to) out.push(`🗓 ${monthShort(l.season_from)}–${monthShort(l.season_to)}`);
  if (l.rain_ok) out.push(`🌧 ${t('rainOk')}`);
  if (l.fitness) out.push(`🥾 ${t('fit.' + l.fitness)}`);
  if (l.licensed) out.push(`🛡 ${t('licensedBadge')}`);
  if (l.min_age) out.push(`👶 ${t('minAgeBadge', { n: l.min_age })}`);
  return out.map((b) => `<span class="badge-s">${b}</span>`).join('');
}

function bg(l) {
  return l.image ? `style="background-image:url('${esc(l.image)}')"` : `style="background:linear-gradient(135deg,#ccfbf1,#fde68a)"`;
}
const thumb = (l, cls = 'thumb') => `<div class="${cls}" ${bg(l)}>${l.image ? '' : ICON[l.category] || '📍'}</div>`;

function card(l) {
  return `<a class="card" href="#/listing/${l.id}">
    <div class="thumb" ${bg(l)}>${l.image ? '' : ICON[l.category] || '📍'}<span class="tag">${esc(catName(l.category))}</span>
      ${l.status === 'paused' ? `<span class="paused">${t('paused')}</span>` : ''}</div>
    <button class="heart" data-fav="${l.id}" title="${t('save')}" aria-label="${t('save')}">${l.favorited ? '❤️' : '🤍'}</button>
    <div class="body"><h3>${esc(l.title)}</h3>
      <div class="meta">📍 ${esc(l.city)}${l.duration ? ' · ' + esc(l.duration) : ''}${l.distance_km != null ? ' · ' + t('kmAway', { n: l.distance_km < 10 ? l.distance_km : Math.round(l.distance_km) }) : ''}</div>
      <div class="badges">${badges(l)}</div>
      <div>${stars(l.rating, l.review_count)}</div>
      <div class="price">${priceLine(l)}</div></div></a>`;
}

function bindHearts(root, onChange) {
  $$('[data-fav]', root).forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!state.user) return (location.hash = '#/login');
    const r = await api(`/listings/${b.dataset.fav}/favorite`, { method: 'POST' });
    b.textContent = r.favorited ? '❤️' : '🤍';
    onChange?.();
  }));
}

const osmTiles = (map) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
const mapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

// ---------- dialog ----------
function openDialog(html, onOpen) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dlg">${html}</div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  onOpen?.(dlg);
  return dlg;
}

// ---------- availability calendar ----------
// mode 'pick': guests choose an open day.  mode 'manage': the host blocks/unblocks days.
function calendar(el, { listingId, mode, onPick }) {
  const now = new Date();
  let cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const minMonth = cur.getTime();
  let selected = null, days = {};
  const iso = (d) => `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  async function draw() {
    const month = iso(1).slice(0, 7);
    days = (await api(`/listings/${listingId}/availability?month=${month}`)).days;
    const lead = (new Date(cur.getFullYear(), cur.getMonth(), 1).getDay() + 6) % 7;
    const count = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    let cells = Array.from({ length: lead }, () => '<span></span>').join('');
    for (let d = 1; d <= count; d++) {
      const date = iso(d), s = days[date];
      let cls = s.open ? 'open' : s.closed ? 'closed' : 'full';
      if (mode === 'manage') cls = s.blocked ? 'blocked' : s.closed ? 'closed' : s.open ? 'open' : 'full';
      const past = date < now.toISOString().slice(0, 10);
      const clickable = mode === 'pick' ? s.open : !past;
      cells += `<button type="button" class="day ${cls} ${selected === date ? 'sel' : ''}" data-date="${date}" ${clickable ? '' : 'disabled'}>${d}${mode === 'manage' && s.booked ? `<small>${s.booked}</small>` : ''}</button>`;
    }
    el.innerHTML = `<div class="cal">
      <div class="cal-head"><button type="button" class="chip" data-nav="-1" ${cur.getTime() <= minMonth ? 'disabled' : ''}>‹</button>
        <b>${new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(cur)}</b><button type="button" class="chip" data-nav="1">›</button></div>
      <div class="cal-grid">${Array.from({ length: 7 }, (_, i) => `<i>${weekdayShort(i)}</i>`).join('')}${cells}</div>
      <div class="cal-legend"><span><u class="open"></u>${t('legendOpen')}</span><span><u class="full"></u>${t('legendFull')}</span><span><u class="${mode === 'manage' ? 'blocked' : 'closed'}"></u>${mode === 'manage' ? t('blocked') : t('legendClosed')}</span></div></div>`;
  }
  el.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { cur = new Date(cur.getFullYear(), cur.getMonth() + Number(nav.dataset.nav), 1); return draw(); }
    const day = e.target.closest('.day');
    if (!day || day.disabled) return;
    const date = day.dataset.date;
    if (mode === 'pick') { selected = date; onPick?.(date, days[date]); draw(); }
    else { try { await api(`/listings/${listingId}/blocked`, { method: 'POST', body: { date } }); draw(); } catch (err) { toast(err.message); } }
  });
  draw();
  return { draw, clear: () => { selected = null; draw(); } };
}
