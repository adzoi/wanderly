// Pages: navigation, browse, listing detail, auth, listing form, dashboard, router.

// ---------- nav ----------
function renderNav() {
  const langSel = `<select id="lang" class="lang" aria-label="Language">${LANGS.map((l) => `<option value="${l.code}" ${l.code === lang ? 'selected' : ''}>🌐 ${l.name}</option>`).join('')}</select>`;
  const curSel = state.rates ? `<select id="cur" class="cur" title="${t('curTitle')}" aria-label="${t('curTitle')}">${state.rates.currencies.map((c) => `<option ${c === displayCur() ? 'selected' : ''}>${c}</option>`).join('')}</select>` : '';
  $('#nav').innerHTML = langSel + curSel + `<a href="#/planner">✨ ${t('nav.planner')}</a><a href="#/collections">${t('nav.collections')}</a>` + (state.user
    ? `<a href="#/trips">${t('nav.trips')}</a><a href="#/favorites">${t('nav.saved')}</a><a href="#/dashboard">${t('nav.dashboard')}</a><a class="cta" href="#/new">${t('nav.post')}</a><button id="logout">${t('nav.logout')}</button>`
    : `<a href="#/login">${t('nav.login')}</a><a class="cta" href="#/register">${t('nav.postShort')}</a>`);
  $('#lang').onchange = (e) => { setLang(e.target.value); renderNav(); route(); };
  $('#cur')?.addEventListener('change', (e) => { setCur(e.target.value); route(); });
  $('#logout')?.addEventListener('click', async () => { await api('/logout', { method: 'POST' }); state.user = null; renderNav(); location.hash = '#/'; toast(t('toast.loggedOut')); });
}

// ---------- browse ----------
const filters = { q: '', category: '', city: '', min: '', max: '', sort: 'newest', view: 'grid', month: '', rain: '', fitness: '', licensed: '', lat: '', lng: '', radius: '', bbox: '', date: '', guests: '' };
let map, mapLayer, settling = false;
const destroyMap = () => { if (map) { map.remove(); map = null; } };

async function browse(favoritesOnly = false) {
  const opts = (arr, cur) => arr.map(([v, text]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(text)}</option>`).join('');
  const near = !!filters.lat;
  const sorts = [['newest', t('sort.newest')], ['rating', t('sort.rating')], ['price_asc', t('sort.priceAsc')], ['price_desc', t('sort.priceDesc')]];
  if (near) sorts.unshift(['distance', t('sort.distance')]);
  app.innerHTML = `
    ${favoritesOnly ? `<h1>${t('saved.title')}</h1>` : `<section class="hero"><h1>${t('hero.title')}</h1><p>${t('hero.sub')}</p>
      <form class="search" id="sf"><input id="q" placeholder="${t('search.ph')}" value="${esc(filters.q)}"><button class="btn accent">${t('search.btn')}</button></form></section>`}
    <div class="chips" id="chips"></div>
    <div class="filters">
      <div><label>${t('city')}</label><select id="city"><option value="">${t('anywhere')}</option>${state.meta.cities.map((c) => `<option ${c === filters.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label>${t('minPrice')} (${displayCur()})</label><input id="min" type="number" min="0" value="${esc(filters.min)}"></div>
      <div><label>${t('maxPrice')} (${displayCur()})</label><input id="max" type="number" min="0" value="${esc(filters.max)}"></div>
      <div><label>${t('sort')}</label><select id="sort">${opts(sorts, filters.sort)}</select></div>
    </div>
    <div class="filters2">
      <button type="button" class="chip ${near ? 'on' : ''}" id="near">${t('nearMe')}</button>
      ${near ? `<div><label>${t('within')}</label> <select id="radius">${opts([10, 25, 50, 100, 200, 500].map((n) => [n, t('km', { n })]), filters.radius)}</select></div>` : ''}
      <div><label>${t('freeOn')}</label> <input type="date" id="date" min="${new Date().toISOString().slice(0, 10)}" value="${esc(filters.date)}" style="width:auto"></div>
      <div><label>${t('guestsF')}</label> <input type="number" id="guests" min="1" placeholder="1" value="${esc(filters.guests)}" style="width:78px"></div>
      <div><label>${t('month')}</label> <select id="month"><option value="">${t('anyMonth')}</option>${opts(Array.from({ length: 12 }, (_, i) => [i + 1, monthLong(i + 1)]), filters.month)}</select></div>
      <div><label>${t('fitness')}</label> <select id="fitness"><option value="">${t('anyFitness')}</option>${opts(state.meta.fitness.map((f) => [f, t('fit.' + f)]), filters.fitness)}</select></div>
      <label class="inline"><input type="checkbox" id="rain" ${filters.rain ? 'checked' : ''}> 🌧 ${t('rainFriendly')}</label>
      <label class="inline"><input type="checkbox" id="licensed" ${filters.licensed ? 'checked' : ''}> 🛡 ${t('licensedOnly')}</label>
    </div>
    <div class="bar"><div class="actions"><span class="meta" id="count"></span><button type="button" class="chip" id="clrarea" ${filters.bbox ? '' : 'hidden'}>✕ ${t('clearArea')}</button></div>
      <div class="actions"><button class="chip ${filters.view === 'grid' ? 'on' : ''}" data-view="grid">${t('view.grid')}</button><button class="chip ${filters.view === 'map' ? 'on' : ''}" data-view="map">${t('view.map')}</button></div></div>
    <div id="results"></div>`;

  const chips = $('#chips');
  chips.innerHTML = ['', ...state.meta.categories].map((c) => `<button class="chip ${filters.category === c ? 'on' : ''}" data-c="${esc(c)}">${c ? (ICON[c] || '') + ' ' + catName(c) : t('all')}</button>`).join('');

  function drawMap(res, listings) {
    let fresh = false;
    if (!map || res.dataset.mode !== 'map') {
      fresh = true;
      destroyMap();
      res.dataset.mode = 'map';
      res.innerHTML = `<div class="mapwrap"><div id="map" style="height:560px"></div><button type="button" class="btn primary area-btn" id="area" hidden>${t('searchArea')}</button></div>`;
      map = L.map('map'); osmTiles(map); mapLayer = L.layerGroup().addTo(map);
      map.on('moveend', () => { if (!settling) $('#area').hidden = false; });
      $('#area').onclick = () => {
        const b = map.getBounds();
        filters.bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((x) => x.toFixed(5)).join(',');
        $('#area').hidden = true; $('#clrarea').hidden = false; load();
      };
    }
    mapLayer.clearLayers();
    const pts = listings.filter((l) => l.lat != null && l.lng != null);
    pts.forEach((l) => L.marker([l.lat, l.lng]).bindPopup(`<b>${esc(l.title)}</b><br>${money(l)} / ${t('unit.' + l.price_unit)}<br><a href="#/listing/${l.id}">${t('view')}</a>`).addTo(mapLayer));
    const coords = pts.map((l) => [l.lat, l.lng]);
    if (near) {
      const me = [Number(filters.lat), Number(filters.lng)];
      L.circleMarker(me, { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip(t('youAreHere')).addTo(mapLayer);
      if (filters.radius) L.circle(me, { radius: filters.radius * 1000, color: '#2563eb', weight: 1, fillOpacity: 0.05 }).addTo(mapLayer);
      coords.push(me);
    }
    // Keep the view the user chose when searching a map area; otherwise fit the results.
    if (fresh || !filters.bbox) {
      settling = true;
      if (coords.length) map.fitBounds(coords, { padding: [40, 40], maxZoom: 12, animate: false }); else map.setView([42.3, 43.5], 7, { animate: false });
      settling = false;
      $('#area').hidden = true;
    }
  }

  async function load() {
    const p = new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== 'view'));
    p.set('cur', displayCur());
    if (favoritesOnly) p.set('favorites', '1');
    const { listings } = await api('/listings?' + p);
    $('#count').textContent = t('count', { n: listings.length });
    const res = $('#results');
    if (filters.view === 'map') return drawMap(res, listings);
    destroyMap(); res.dataset.mode = 'grid';
    if (!listings.length) { res.innerHTML = `<div class="empty">${t('empty')}</div>`; return; }
    res.innerHTML = `<div class="grid">${listings.map(card).join('')}</div>`;
    bindHearts(res, favoritesOnly ? load : null);
  }

  chips.onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; filters.category = b.dataset.c; $$('.chip', chips).forEach((x) => x.classList.toggle('on', x === b)); load(); };
  $$('[data-view]', app).forEach((b) => b.onclick = () => { filters.view = b.dataset.view; $$('[data-view]', app).forEach((x) => x.classList.toggle('on', x === b)); load(); });
  for (const id of ['city', 'sort', 'min', 'max', 'month', 'fitness', 'radius', 'date', 'guests']) $('#' + id)?.addEventListener('change', (e) => { filters[id] = e.target.value; load(); });
  for (const id of ['rain', 'licensed']) $('#' + id).onchange = (e) => { filters[id] = e.target.checked ? '1' : ''; load(); };
  $('#sf')?.addEventListener('submit', (e) => { e.preventDefault(); filters.q = $('#q').value.trim(); load(); });
  $('#clrarea').onclick = () => { filters.bbox = ''; $('#clrarea').hidden = true; load(); };
  $('#near').onclick = () => {
    if (near) {
      Object.assign(filters, { lat: '', lng: '', radius: '' });
      if (filters.sort === 'distance') filters.sort = 'newest';
      return browse(favoritesOnly);
    }
    if (!navigator.geolocation) return toast(t('locUnsupported'));
    toast(t('locating'));
    navigator.geolocation.getCurrentPosition(
      (pos) => { Object.assign(filters, { lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5), radius: '100', sort: 'distance', bbox: '' }); browse(favoritesOnly); },
      () => toast(t('locDenied')), { timeout: 10000 });
  };
  load();
}

// ---------- detail ----------
async function detail(id) {
  const { listing: l, reviews } = await api('/listings/' + id);
  const imgs = l.images;
  const seasonText = l.season_from && l.season_to ? `${monthLong(l.season_from)} – ${monthLong(l.season_to)}` : t('allYear');
  const showSeason = (l.season_from && l.season_to) || l.rain_ok || l.rain_note;
  const showSafety = l.fitness || l.min_age || l.licensed || l.safety_notes;
  const converted = displayCur() !== l.currency;
  app.innerHTML = `<div class="detail"><div>
      <div class="gallery">${thumb({ image: imgs[0], category: l.category }, 'hero-img')}
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-img="${esc(u)}" style="background-image:url('${esc(u)}')"></button>`).join('')}</div>` : ''}</div>
      <div class="bar"><div><span class="tag" style="position:static">${esc(catName(l.category))}</span></div>
        <div class="actions">${l.is_owner ? `<a class="btn sm" href="#/edit/${l.id}">${t('edit')}</a>` : `<button class="btn sm" id="fav">${l.favorited ? t('saved') : t('saveBtn')}</button>`}</div></div>
      <h1 style="margin:6px 0">${esc(l.title)}</h1>
      <div class="meta">📍 ${esc(l.city)}${l.address ? ', ' + esc(l.address) : ''} · ${t('hostedBy')}: <a href="#/host/${l.host_id}">${esc(l.host_name)}</a> · ${stars(l.rating, l.review_count)}</div>
      <div class="facts">
        ${l.duration ? `<div class="fact">⏱ ${esc(l.duration)}</div>` : ''}
        ${l.max_group ? `<div class="fact">👥 ${t('maxGroup', { n: l.max_group })}</div>` : ''}
        ${l.languages ? `<div class="fact">🗣 ${esc(l.languages)}</div>` : ''}
        ${l.status === 'paused' ? `<div class="fact">${t('pausedNote')}</div>` : ''}</div>
      <p style="white-space:pre-wrap">${esc(l.description)}</p>
      ${showSeason ? `<h2>${t('seasonTitle')}</h2><dl class="info"><dt>🗓 ${t('season')}</dt><dd>${seasonText}</dd>
        ${l.rain_ok || l.rain_note ? `<dt>🌧 ${t('ifRain')}</dt><dd>${l.rain_note ? esc(l.rain_note) : t('rainOk')}</dd>` : ''}</dl>` : ''}
      ${showSafety ? `<h2>${t('safetyTitle')}</h2><dl class="info">
        ${l.fitness ? `<dt>🥾 ${t('fitnessLevel')}</dt><dd>${t('fit.' + l.fitness)}</dd>` : ''}
        ${l.min_age ? `<dt>👶 ${t('minAge')}</dt><dd>${l.min_age}+</dd>` : ''}
        ${l.licensed ? `<dt>🛡 ${t('licensedGuide')}</dt><dd>${t('yes')}</dd>` : ''}
        ${l.safety_notes ? `<dt>⚠️</dt><dd style="white-space:pre-wrap">${esc(l.safety_notes)}</dd>` : ''}</dl>` : ''}
      ${l.lat != null ? `<h2>${t('location')}</h2><div class="map" id="m"></div>` : ''}
      <h2>${t('reviews')}</h2>
      <div id="reviews">${reviews.length ? reviews.map((r) => `<div class="review"><b>${esc(r.name)}</b> <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span><div>${esc(r.comment)}</div>
        ${r.reply ? `<div class="reply"><b>↩ ${t('hostReply')}:</b> ${esc(r.reply)}</div>` : l.is_owner ? `<form class="rpl" data-rid="${r.id}"><input placeholder="${t('replyPh')}" required maxlength="1000"><button class="btn sm">${t('reply')}</button></form>` : ''}</div>`).join('') : `<div class="meta">${t('noReviews')}</div>`}</div>
      ${!l.is_owner && !l.can_review ? `<div class="meta" style="margin-top:12px">🔒 ${t('reviewLocked')}</div>` : ''}
      ${l.can_review ? `<form id="rf" class="panel stack" style="margin-top:16px"><b>${t('leaveReview')}</b>
        <select id="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select>
        <textarea id="comment" placeholder="${t('reviewPh')}" style="min-height:70px"></textarea><div class="err" id="rerr"></div><button class="btn primary">${t('sendReview')}</button></form>` : ''}
    </div>
    <aside class="sticky stack">
      <div class="panel stack">
        <div>${priceLine(l)}${converted ? `<div class="meta">${t('listedPrice')}: ${fmtMoney(l.price, l.currency)} · ${t(state.rates?.live ? 'ratesNote' : 'ratesOffline')}</div>` : ''}</div>
        ${l.is_owner ? `<div class="meta">${t('yourListing')}</div><a class="btn" href="#/edit/${l.id}">${t('calendarH')}</a>` : `<form id="bf" class="stack">
          <div><label>${t('availability')}</label><div id="cal"></div></div>
          <div class="meta" id="picked">${t('selectDate')}</div>
          <div><label>${t('guests')}</label><input type="number" id="guests" min="1" ${l.max_group ? `max="${l.max_group}"` : ''} value="1"></div>
          <div><label>${t('noteHost')}</label><textarea id="note" style="min-height:70px"></textarea></div>
          <div class="meta" id="total"></div><div class="err" id="berr"></div>
          <button class="btn primary" style="width:100%">${t('requestBook')}</button>
          <div class="meta" style="text-align:center">${t('noCharge')}</div>
          ${l.meet_note === undefined ? `<div class="meta" style="text-align:center">📍 ${t('meetingLocked')}</div>` : ''}</form>`}
      </div>
      ${l.is_owner ? '' : '<div class="panel" id="trip-panel"></div>'}
    </aside></div>`;

  if (l.lat != null) {
    const m = L.map('m').setView([l.lat, l.lng], 13); osmTiles(m); L.marker([l.lat, l.lng]).addTo(m);
  }
  $$('.thumbs button').forEach((b) => b.onclick = () => {
    $('.hero-img').style.backgroundImage = `url('${b.dataset.img}')`;
    $$('.thumbs button').forEach((x) => x.classList.toggle('on', x === b));
  });
  const needAuth = () => { if (!state.user) { location.hash = '#/login'; return true; } };
  $('#fav')?.addEventListener('click', async () => { if (needAuth()) return; const r = await api(`/listings/${id}/favorite`, { method: 'POST' }); $('#fav').textContent = r.favorited ? t('saved') : t('saveBtn'); });

  let picked = null;
  const total = () => {
    const g = +$('#guests').value || 1;
    if (l.price_unit !== 'person') return ($('#total').textContent = '');
    const to = displayCur();
    $('#total').textContent = `${t('estTotal')}: ${to === l.currency ? '' : '≈ '}${fmtMoney(convert(l.price * g, l.currency, to), to)}`;
  };
  if ($('#cal')) {
    calendar($('#cal'), { listingId: id, mode: 'pick', onPick: (date, info) => {
      picked = date;
      $('#picked').textContent = `📅 ${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${info.remaining !== null ? ' · ' + t('spotsLeft', { n: info.remaining }) : ''}`;
    } });
    $('#guests').addEventListener('input', total); total();
  }
  $('#bf')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (needAuth()) return;
    if (!picked) return ($('#berr').textContent = t('pickDateFirst'));
    try { await api(`/listings/${id}/bookings`, { method: 'POST', body: { date: picked, guests: $('#guests').value, note: $('#note').value } }); toast(t('reqSent')); location.hash = '#/dashboard'; }
    catch (err) { $('#berr').textContent = err.message; }
  });
  $('#rf')?.addEventListener('submit', async (e) => {
    e.preventDefault(); if (needAuth()) return;
    try { await api(`/listings/${id}/reviews`, { method: 'POST', body: { rating: $('#rating').value, comment: $('#comment').value } }); toast(t('thanksReview')); detail(id); }
    catch (err) { $('#rerr').textContent = err.message; }
  });
  $$('.rpl').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/reviews/${f.dataset.rid}/reply`, { method: 'POST', body: { reply: $('input', f).value } }); detail(id); }
    catch (err) { toast(err.message); }
  }));
  if ($('#trip-panel')) tripPanel($('#trip-panel'), id);
}

// ---------- auth ----------
function authView(mode) {
  const reg = mode === 'register';
  app.innerHTML = `<form class="panel auth stack" id="af"><h2 style="margin:0">${reg ? t('createAcc') : t('welcomeBack')}</h2>
    ${reg ? `<div><label>${t('yourName')}</label><input id="name" required></div>` : ''}
    <div><label>${t('email')}</label><input id="email" type="email" required></div>
    <div><label>${reg ? t('password8') : t('password')}</label><input id="pw" type="password" required minlength="${reg ? 8 : 1}"></div>
    <div class="err" id="err"></div><button class="btn primary" style="width:100%">${reg ? t('signup') : t('nav.login')}</button>
    ${reg ? '' : `<div class="meta" style="text-align:center"><a href="#/forgot">${t('forgotPw')}</a></div>`}
    <div class="meta" style="text-align:center">${reg ? `${t('haveAcc')} <a href="#/login">${t('signinLink')}</a>` : `${t('newHere')} <a href="#/register">${t('createLink')}</a>`}</div></form>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(reg ? '/register' : '/login', { method: 'POST', body: { name: reg ? $('#name').value : undefined, email: $('#email').value, password: $('#pw').value } });
      state.user = r.user; renderNav(); toast(t('hi', { n: r.user.name })); location.hash = '#/';
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function forgotView() {
  app.innerHTML = `<form class="panel auth stack" id="ff"><h2 style="margin:0">${t('forgotTitle')}</h2><div class="meta">${t('forgotSub')}</div>
    <div><label>${t('email')}</label><input id="email" type="email" required></div>
    <div class="err" id="err"></div><button class="btn primary" style="width:100%">${t('sendLink')}</button>
    <div class="meta" style="text-align:center"><a href="#/login">${t('signinLink')}</a></div></form>`;
  $('#ff').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/forgot', { method: 'POST', body: { email: $('#email').value } }); $('#ff').innerHTML = `<div style="padding:8px 0">📬 ${t('forgotSent')}</div>`; }
    catch (err) { $('#err').textContent = err.message; }
  };
}

function resetView(token) {
  app.innerHTML = `<form class="panel auth stack" id="rf2"><h2 style="margin:0">${t('resetTitle')}</h2>
    <div><label>${t('newPassword')}</label><input id="pw" type="password" required minlength="8"></div>
    <div class="err" id="err"></div><button class="btn primary" style="width:100%">${t('setPassword')}</button></form>`;
  $('#rf2').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/reset', { method: 'POST', body: { token, password: $('#pw').value } }); state.user = null; renderNav(); toast(t('resetDone')); location.hash = '#/login'; }
    catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- listing form ----------
const CITY_COORDS = { 'თბილისი': [41.7151, 44.8271], 'ბათუმი': [41.6168, 41.6367], 'ქუთაისი': [42.2679, 42.718], 'ყაზბეგი': [42.6586, 44.6431], 'მესტია': [43.0452, 42.7279], 'თელავი': [41.9198, 45.4731], 'სიღნაღი': [41.6192, 45.9226] };
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first; values match JS getDay()

async function listingForm(id) {
  let l = { currency: 'GEL', price_unit: 'person', status: 'active', weekdays: '0123456', season_from: 0, season_to: 0, images: [] };
  if (id) l = (await api('/listings/' + id + '?raw=1')).listing;
  const tr = l.translations || {};
  let images = [...l.images];
  const opt = (arr, cur, label = (v) => v) => arr.map((v) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  const months = (cur) => `<option value="0" ${!cur ? 'selected' : ''}>${t('allYearOpt')}</option>` + opt(Array.from({ length: 12 }, (_, i) => i + 1), cur, monthLong);
  app.innerHTML = `<form class="form panel stack" id="lf"><h1 style="margin:0">${id ? t('editSvc') : t('postSvc')}</h1>
    <div><label>${t('titleL')}</label><input id="title" required maxlength="120" placeholder="${t('titlePh')}" value="${esc(l.title)}"></div>
    <div class="row"><div><label>${t('category')}</label><select id="category"><option value="">${t('choose')}</option>${opt(state.meta.categories, l.category, catName)}</select></div>
      <div><label>${t('city')}</label><input id="city" list="cities" required value="${esc(l.city)}"><datalist id="cities">${Object.keys(CITY_COORDS).map((c) => `<option>${c}</option>`).join('')}</datalist></div></div>
    <div><label>${t('desc')}</label><textarea id="description" required placeholder="${t('descPh')}">${esc(l.description)}</textarea></div>
    <div class="row"><div><label>${t('price')}</label><input id="price" type="number" min="0" step="0.01" required value="${l.price ?? ''}"></div>
      <div class="row"><div><label>${t('currency')}</label><select id="currency">${opt(state.meta.currencies, l.currency)}</select></div>
      <div><label>${t('unit')}</label><select id="price_unit">${opt(state.meta.units, l.price_unit, (v) => t('unit.' + v))}</select></div></div></div>
    <div class="row"><div><label>${t('duration')}</label><input id="duration" placeholder="${t('durationPh')}" value="${esc(l.duration)}"></div>
      <div><label>${t('maxGroupL')}</label><input id="max_group" type="number" min="1" value="${l.max_group ?? ''}"></div></div>
    <div class="row"><div><label>${t('languages')}</label><input id="languages" placeholder="${t('languagesPh')}" value="${esc(l.languages)}"></div>
      <div><label>${t('address')}</label><input id="address" value="${esc(l.address)}"></div></div>

    <details class="panel"><summary><b>🌐 ${t('translationsH')}</b></summary>
      <div class="meta" style="margin:8px 0">${t('translationsHelp')}</div>
      ${LANGS.map((g) => `<fieldset class="tr" data-lang="${g.code}"><legend>${g.name}</legend>
        <input data-f="title" placeholder="${t('titleL')}" maxlength="120" value="${esc(tr[g.code]?.title)}">
        <textarea data-f="description" placeholder="${t('desc')}" style="min-height:70px;margin-top:6px">${esc(tr[g.code]?.description)}</textarea></fieldset>`).join('')}</details>

    <div><label>${t('photos')}</label><input id="file" type="file" multiple accept="image/jpeg,image/png,image/webp"><div class="meta">${t('photosHint')}</div><div class="photo-grid" id="photos"></div></div>

    <h3 style="margin:8px 0 0">${t('seasonTitle')}</h3>
    <div class="row"><div><label>${t('seasonFrom')}</label><select id="season_from">${months(l.season_from)}</select></div><div><label>${t('seasonTo')}</label><select id="season_to">${months(l.season_to)}</select></div></div>
    <label class="inline"><input type="checkbox" id="rain_ok" ${l.rain_ok ? 'checked' : ''}> 🌧 ${t('rainOkL')}</label>
    <div><label>${t('rainNoteL')}</label><input id="rain_note" value="${esc(l.rain_note)}"></div>

    <h3 style="margin:8px 0 0">${t('safetyH')}</h3>
    <div class="row"><div><label>${t('fitnessL')}</label><select id="fitness"><option value="">—</option>${opt(state.meta.fitness, l.fitness, (v) => t('fit.' + v))}</select></div>
      <div><label>${t('minAgeFld')}</label><input id="min_age" type="number" min="0" max="99" value="${l.min_age ?? ''}"></div></div>
    <label class="inline"><input type="checkbox" id="licensed" ${l.licensed ? 'checked' : ''}> 🛡 ${t('licensedL')}</label>
    <div><label>${t('safetyNotesL')}</label><textarea id="safety_notes" style="min-height:70px">${esc(l.safety_notes)}</textarea></div>

    <h3 style="margin:8px 0 0">${t('availability')}</h3>
    <div><label>${t('workingDays')}</label><div class="checks" id="weekdays">${WEEK.map((d) => `<label><input type="checkbox" value="${d}" ${l.weekdays.includes(d) ? 'checked' : ''}>${weekdayShort((d + 6) % 7)}</label>`).join('')}</div></div>
    <div><label>${t('dailyCap')}</label><input id="daily_capacity" type="number" min="1" value="${l.daily_capacity ?? ''}"></div>

    <h3 style="margin:8px 0 0">${t('location')}</h3>
    <div class="meta">${t('pinHelp')}</div>
    <div class="checks"><label><input type="radio" name="pinmode" value="listing" checked> ${t('pinListing')}</label><label><input type="radio" name="pinmode" value="meet"> ${t('pinMeeting')}</label></div>
    <div class="map" id="pick" style="height:320px"></div>
    <div><label>${t('meetingH')}</label><textarea id="meet_note" style="min-height:70px" placeholder="${t('meetNoteL')}">${esc(l.meet_note)}</textarea></div>

    ${id ? `<div><label>${t('statusL')}</label><select id="status"><option value="active" ${l.status === 'active' ? 'selected' : ''}>${t('active')}</option><option value="paused" ${l.status === 'paused' ? 'selected' : ''}>${t('pausedOpt')}</option></select></div>` : ''}
    <div class="err" id="err"></div><button class="btn primary">${id ? t('saveChanges') : t('publish')}</button></form>
    <div class="form panel" style="margin-top:20px"><h2 style="margin-top:0">${t('calendarH')}</h2>
      ${id ? `<div class="meta" style="margin-bottom:8px">${t('calendarHelp')}</div><div id="mcal" style="max-width:380px"></div>` : `<div class="meta">${t('calAfterSave')}</div>`}</div>`;

  // photos
  const drawPhotos = () => {
    $('#photos').innerHTML = images.map((u, i) => `<div class="photo" style="background-image:url('${esc(u)}')">${i === 0 ? `<b>${t('cover')}</b>` : `<button type="button" class="mk" data-cover="${i}">${t('makeCover')}</button>`}<button type="button" class="x" data-rm="${i}" aria-label="${t('removeL')}">✕</button></div>`).join('');
  };
  drawPhotos();
  $('#photos').onclick = (e) => {
    const rm = e.target.closest('[data-rm]'), mk = e.target.closest('[data-cover]');
    if (rm) images.splice(+rm.dataset.rm, 1);
    if (mk) images.unshift(...images.splice(+mk.dataset.cover, 1));
    drawPhotos();
  };
  $('#file').onchange = async (e) => {
    for (const f of e.target.files) {
      if (images.length >= 8) { toast(t('photos')); break; }
      try { const r = await api('/upload', { method: 'POST', raw: true, body: f, headers: { 'Content-Type': f.type } }); images.push(r.url); drawPhotos(); }
      catch (err) { toast(err.message); }
    }
    e.target.value = '';
  };

  // map with two pins
  const emojiPin = L.divIcon({ className: 'emoji-pin', html: '🚩', iconSize: [26, 26], iconAnchor: [5, 24] });
  const start = l.lat != null ? [l.lat, l.lng] : [42.0, 43.5];
  const m = L.map('pick').setView(start, l.lat != null ? 13 : 7); osmTiles(m);
  const pins = { listing: null, meet: null };
  const pos = { listing: l.lat != null ? { lat: l.lat, lng: l.lng } : null, meet: l.meet_lat != null ? { lat: l.meet_lat, lng: l.meet_lng } : null };
  const place = (kind, ll) => {
    pos[kind] = { lat: ll.lat, lng: ll.lng };
    if (pins[kind]) pins[kind].setLatLng(ll); else pins[kind] = L.marker(ll, kind === 'meet' ? { icon: emojiPin } : {}).addTo(m);
  };
  for (const k of ['listing', 'meet']) if (pos[k]) place(k, pos[k]);
  m.on('click', (e) => place($('input[name=pinmode]:checked').value, e.latlng));
  $('#city').addEventListener('change', (e) => { const c = CITY_COORDS[e.target.value]; if (c && !pos.listing) m.setView(c, 12); });
  if (id) calendar($('#mcal'), { listingId: id, mode: 'manage' });

  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const val = (k) => $('#' + k).value;
    const body = Object.fromEntries(['title', 'category', 'city', 'description', 'price', 'currency', 'price_unit', 'duration', 'max_group', 'languages', 'address',
      'season_from', 'season_to', 'rain_note', 'fitness', 'min_age', 'safety_notes', 'daily_capacity', 'meet_note'].map((k) => [k, val(k)]));
    Object.assign(body, {
      images, translations: Object.fromEntries($$('.tr').map((f) => [f.dataset.lang, { title: $('[data-f=title]', f).value, description: $('[data-f=description]', f).value }])),
      rain_ok: $('#rain_ok').checked, licensed: $('#licensed').checked,
      weekdays: $$('#weekdays input:checked').map((c) => c.value).join(''),
      lat: pos.listing?.lat ?? null, lng: pos.listing?.lng ?? null, meet_lat: pos.meet?.lat ?? null, meet_lng: pos.meet?.lng ?? null,
    });
    if (id) body.status = val('status');
    try { const r = await api(id ? '/listings/' + id : '/listings', { method: id ? 'PUT' : 'POST', body }); toast(id ? t('savedToast') : t('publishedToast')); location.hash = '#/listing/' + r.id; }
    catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- dashboard ----------
function meetingDialog(b) {
  const has = b.meet_lat != null;
  openDialog(`<h2 style="margin-top:0">📍 ${t('meetingPoint')}</h2><b>${esc(b.title)}</b>
    <div class="meta">${esc(fmtDate(b.date))} · ${esc(b.city)}${b.address ? ', ' + esc(b.address) : ''}</div>
    ${b.meet_note ? `<p style="white-space:pre-wrap">${esc(b.meet_note)}</p>` : ''}
    ${has ? '<div class="map" id="mm"></div>' : ''}
    <div class="actions">${has ? `<a class="btn primary" target="_blank" rel="noopener" href="${mapsLink(b.meet_lat, b.meet_lng)}">${t('openMaps')}</a><button class="btn" id="shr">${t('share')}</button>` : ''}<button class="btn" id="cls">${t('close')}</button></div>`, (dlg) => {
    $('#cls', dlg).onclick = () => dlg.close();
    if (!has) return;
    const mm = L.map($('#mm', dlg)).setView([b.meet_lat, b.meet_lng], 15); osmTiles(mm); L.marker([b.meet_lat, b.meet_lng]).addTo(mm);
    setTimeout(() => mm.invalidateSize(), 60);
    $('#shr', dlg).onclick = async () => {
      const url = mapsLink(b.meet_lat, b.meet_lng), text = `${b.title} — ${b.meet_note || ''}`.trim();
      if (navigator.share) { try { await navigator.share({ title: b.title, text, url }); } catch {} }
      else { try { await navigator.clipboard.writeText(`${text}\n${url}`); toast(t('linkCopied')); } catch { toast(url); } }
    };
  });
}

async function dashboard() {
  const [{ listings }, { made, incoming }] = await Promise.all([api('/listings?mine=1&cur=' + displayCur()), api('/bookings')]);
  const bTable = (rows, host) => rows.length ? `<div class="scroll"><table class="table"><tr><th>${t('offer')}</th><th>${host ? t('guestCol') : t('hostCol')}</th><th>${t('date')}</th><th>${t('guests')}</th><th>${t('statusL')}</th><th></th></tr>
    ${rows.map((b) => `<tr><td><a href="#/listing/${b.listing_id}">${esc(b.title)}</a></td>
      <td>${host ? `${esc(b.guest_name)}<div class="meta">${esc(b.guest_email)}</div>${b.note ? `<div class="meta">“${esc(b.note)}”</div>` : ''}` : `<a href="#/host/${b.host_id}">${esc(b.host_name)}</a>`}</td>
      <td>${esc(b.date)}</td><td>${b.guests}</td><td><span class="badge ${b.status}">${t('status.' + b.status)}</span></td>
      <td><div class="actions">${host && b.status === 'pending' ? `<button class="btn sm primary" data-b="${b.id}" data-s="confirmed">${t('confirm')}</button><button class="btn sm danger" data-b="${b.id}" data-s="declined">${t('decline')}</button>` : ''}
      ${!host && b.status === 'confirmed' ? `<button class="btn sm" data-meet="${b.id}">📍 ${t('meetingPoint')}</button>` : ''}
      ${!host && b.status === 'pending' ? `<span class="meta">📍 ${t('meetingLocked')}</span>` : ''}
      ${!host && ['pending', 'confirmed'].includes(b.status) ? `<button class="btn sm danger" data-b="${b.id}" data-s="cancelled">${t('cancel')}</button>` : ''}</div></td></tr>`).join('')}</table></div>` : `<div class="meta">${t('nothing')}</div>`;

  app.innerHTML = `<div class="bar"><h1 style="margin:0">${t('dashboard')}</h1><a class="btn primary" href="#/new">${t('nav.post')}</a></div>
    <h2>${t('bookingReq')}</h2>${bTable(incoming, true)}
    <h2>${t('myListings')}</h2>${listings.length ? `<div class="grid">${listings.map((l) => `<div>${card(l)}<div class="actions" style="margin-top:8px"><a class="btn sm" href="#/edit/${l.id}">${t('edit')} · ${t('calendarH')}</a><button class="btn sm danger" data-del="${l.id}">${t('del')}</button></div></div>`).join('')}</div>` : `<div class="meta">${t('nothingPosted')}</div>`}
    <h2>${t('myTrips')}</h2>${bTable(made, false)}
    <h2>${t('profileH')}</h2>
    <form id="pf" class="panel stack" style="max-width:560px"><div><label>${t('yourName')}</label><input id="pname" value="${esc(state.user.name)}" required></div>
      <div><label>${t('bioL')}</label><textarea id="pbio" style="min-height:90px">${esc(state.user.bio)}</textarea></div>
      <div class="err" id="perr"></div><div class="actions"><button class="btn primary">${t('saveProfile')}</button><a class="btn" href="#/host/${state.user.id}">${t('viewPublic')}</a></div></form>`;
  bindHearts(app);
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/me', { method: 'PUT', body: { name: $('#pname').value, bio: $('#pbio').value } }); state.user = { ...state.user, ...r.user }; toast(t('savedToast')); }
    catch (err) { $('#perr').textContent = err.message; }
  };
  app.onclick = async (e) => {
    const b = e.target.closest('[data-b]');
    if (b) { await api('/bookings/' + b.dataset.b, { method: 'PATCH', body: { status: b.dataset.s } }); toast(t('updated')); dashboard(); }
    const meet = e.target.closest('[data-meet]');
    if (meet) meetingDialog(made.find((x) => x.id === +meet.dataset.meet));
    const d = e.target.closest('[data-del]');
    if (d && confirm(t('confirmDelete'))) { await api('/listings/' + d.dataset.del, { method: 'DELETE' }); toast(t('deleted')); dashboard(); }
  };
}

// ---------- router ----------
async function route() {
  destroyMap();
  app.onclick = null;
  const [, page, arg] = location.hash.slice(1).split('/');
  const guarded = ['dashboard', 'new', 'edit', 'favorites', 'trips', 'trip'];
  try {
    if (guarded.includes(page) && !state.user) return (location.hash = '#/login');
    if (page === 'listing') await detail(arg);
    else if (page === 'login' || page === 'register') authView(page);
    else if (page === 'new') await listingForm();
    else if (page === 'edit') await listingForm(arg);
    else if (page === 'dashboard') await dashboard();
    else if (page === 'favorites') await browse(true);
    else if (page === 'planner') await plannerPage();
    else if (page === 'trips') await tripsPage();
    else if (page === 'trip' || page === 'collection') await planPage(arg);
    else if (page === 'collections') await collectionsPage();
    else if (page === 'host') await hostPage(arg);
    else if (page === 'forgot') forgotView();
    else if (page === 'reset') resetView(arg);
    else await browse();
    window.scrollTo(0, 0);
  } catch (err) {
    if (err.status === 401) location.hash = '#/login';
    else app.innerHTML = `<div class="empty">${esc(err.message)}<br><br><a class="btn" href="#/">${t('back')}</a></div>`;
  }
}

(async () => {
  [state.user, state.meta, state.rates] = await Promise.all([api('/me').then((r) => r.user), api('/meta'), api('/rates').catch(() => null)]);
  renderNav();
  window.addEventListener('hashchange', route);
  route();
})();
