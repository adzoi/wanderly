// Trips (personal planner), collections (shareable itineraries) and host profile pages.

const planCard = (p) => `<a class="card plan" href="#/${p.kind}/${p.id}">
  <div class="thumb" style="background:linear-gradient(135deg,#bae6fd,#fde68a)">${p.kind === 'trip' ? '🧳' : '🗺️'}</div>
  <div class="body"><h3>${esc(p.title)}</h3>
    ${p.kind === 'collection' ? `<div class="meta">${t('byOwner', { n: esc(p.owner_name) })}</div>` : ''}
    <div class="meta">${t('nDays', { n: p.days })} · ${t('nExperiences', { n: p.item_count })}${p.start_date ? ' · ' + esc(fmtDate(p.start_date)) : ''}</div>
    ${p.cities ? `<div class="meta">📍 ${esc(p.cities.split(',').join(' · '))}</div>` : ''}
    ${p.description ? `<div class="meta">${esc(p.description.slice(0, 90))}${p.description.length > 90 ? '…' : ''}</div>` : ''}</div></a>`;

const dayOptions = (plan, cur, withUnscheduled = true) => {
  const out = [];
  if (withUnscheduled) out.push([0, t('notScheduled')]);
  for (let d = 1; d <= plan.days; d++) out.push([d, plan.start_date ? `${t('dayN', { n: d })} · ${fmtDate(addDays(plan.start_date, d - 1))}` : t('dayN', { n: d })]);
  return out.map(([v, text]) => `<option value="${v}" ${Number(cur) === v ? 'selected' : ''}>${esc(text)}</option>`).join('');
};

// ---------- my trips ----------
async function tripsPage() {
  const { plans } = await api('/plans?mine=1&kind=trip');
  app.innerHTML = `<div class="bar"><div><h1 style="margin:0">${t('trips.title')}</h1><div class="meta">${t('trips.sub')}</div></div></div>
    <form id="nf" class="panel stack" style="max-width:640px;margin:16px 0"><b>${t('trips.new')}</b>
      <div><label>${t('trips.name')}</label><input id="tname" required placeholder="${t('trips.namePh')}"></div>
      <div class="row"><div><label>${t('startDateOpt')}</label><input id="tstart" type="date" min="${new Date().toISOString().slice(0, 10)}"></div>
        <div><label>${t('daysCount')}</label><input id="tdays" type="number" min="1" max="30" value="3" required></div></div>
      <div class="err" id="err"></div><button class="btn primary">${t('create')}</button></form>
    ${plans.length ? `<div class="grid">${plans.map(planCard).join('')}</div>` : `<div class="empty">${t('trips.empty')}</div>`}`;
  $('#nf').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/plans', { method: 'POST', body: { kind: 'trip', title: $('#tname').value, start_date: $('#tstart').value, days: $('#tdays').value } }); location.hash = '#/trip/' + r.id; }
    catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- collections ----------
async function collectionsPage() {
  const [{ plans }, mine] = await Promise.all([api('/plans?kind=collection'), state.user ? api('/plans?mine=1&kind=collection') : { plans: [] }]);
  const mineOnly = mine.plans.filter((p) => !plans.some((x) => x.id === p.id));
  app.innerHTML = `<div class="bar"><div><h1 style="margin:0">${t('collections.title')}</h1><div class="meta">${t('collections.sub')}</div></div>
      <button class="btn primary" id="newcol">+ ${t('collections.new')}</button></div>
    <form id="nf" class="panel stack" style="max-width:640px;margin:16px 0;display:none"><b>${t('collections.new')}</b>
      <div><label>${t('titleL')}</label><input id="ctitle" required placeholder="${t('dayN', { n: 3 })} — Svaneti"></div>
      <div><label>${t('descOpt')}</label><textarea id="cdesc" style="min-height:70px"></textarea></div>
      <div><label>${t('daysCount')}</label><input id="cdays" type="number" min="1" max="30" value="3" required></div>
      <label class="inline"><input type="checkbox" id="cpub" checked> ${t('makePublic')}</label>
      <div class="err" id="err"></div><button class="btn primary">${t('create')}</button></form>
    ${plans.length ? `<div class="grid">${plans.map(planCard).join('')}</div>` : `<div class="empty">${t('collections.empty')}</div>`}
    ${mineOnly.length ? `<h2>${t('collections.mine')}</h2><div class="grid">${mineOnly.map(planCard).join('')}</div>` : ''}`;
  $('#newcol').onclick = () => { if (!state.user) return (location.hash = '#/login'); $('#nf').style.display = 'flex'; $('#nf').classList.add('stack'); $('#ctitle').focus(); };
  $('#nf').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/plans', { method: 'POST', body: { kind: 'collection', title: $('#ctitle').value, description: $('#cdesc').value, days: $('#cdays').value, is_public: $('#cpub').checked } }); location.hash = '#/collection/' + r.id; }
    catch (err) { $('#err').textContent = err.message; }
  };
}

// ---------- one plan (trip or collection), day by day ----------
async function planPage(id) {
  const { plan, items } = await api('/plans/' + id);
  const owner = plan.is_owner, isTrip = plan.kind === 'trip';
  const cur = displayCur();
  const total = items.reduce((s, i) => s + convert(i.price, i.currency, cur), 0);
  const byDay = {};
  for (const i of items) (byDay[i.day] ||= []).push(i);
  const dayList = [...(isTrip || byDay[0] ? [0] : []), ...Array.from({ length: plan.days }, (_, i) => i + 1)];

  const itemRow = (i) => `<div class="item">${thumb(i)}
    <div class="grow"><a href="#/listing/${i.listing_id}">${esc(i.title)}</a> ${i.status !== 'active' ? `<span class="meta">${t('pausedItem')}</span>` : ''}
      <div class="meta">📍 ${esc(i.city)}${i.duration ? ' · ' + esc(i.duration) : ''} · <b>${money(i)}</b> / ${t('unit.' + i.price_unit)}</div>
      ${i.note ? `<div class="meta">📝 ${esc(i.note)}</div>` : ''}</div>
    ${owner ? `<select data-move="${i.id}" aria-label="${t('moveTo')}">${dayOptions(plan, i.day, isTrip)}</select><button class="btn sm danger" data-rm="${i.id}">${t('removeL')}</button>`
      : ''}${isTrip && i.status === 'active' ? `<a class="btn sm primary" href="#/listing/${i.listing_id}">${t('bookThis')}</a>` : ''}</div>`;

  app.innerHTML = `<div class="bar"><div><h1 style="margin:0">${isTrip ? '🧳' : '🗺️'} ${esc(plan.title)}</h1>
      <div class="meta">${isTrip ? '' : t('byOwner', { n: `<a href="#/host/${plan.owner_id}">${esc(plan.owner_name)}</a>`}) + ' · '}${t('nDays', { n: plan.days })}${plan.start_date ? ' · ' + esc(fmtDate(plan.start_date, { day: 'numeric', month: 'long', year: 'numeric' })) + ' →' : ''} · ${owner ? (plan.is_public ? t('publicNote') : t('privateNote')) : t('publicNote')}</div></div>
      <div class="actions">${!owner && !isTrip ? `<button class="btn primary" id="plan">🧳 ${t('planThis')}</button>` : ''}
        ${owner ? `<button class="btn sm" id="editp">${t('editDetails')}</button><button class="btn sm danger" id="delp">${t('delPlan')}</button>` : ''}</div></div>
    ${plan.description ? `<p style="white-space:pre-wrap">${esc(plan.description)}</p>` : ''}
    ${owner ? `<form id="ef" class="panel stack" style="display:none;max-width:640px;margin-bottom:16px">
      <div><label>${t('titleL')}</label><input id="etitle" required value="${esc(plan.title)}"></div>
      <div><label>${t('descOpt')}</label><textarea id="edesc" style="min-height:70px">${esc(plan.description)}</textarea></div>
      <div class="row">${isTrip ? `<div><label>${t('startDateOpt')}</label><input id="estart" type="date" value="${esc(plan.start_date)}"></div>` : '<div></div>'}
        <div><label>${t('daysCount')}</label><input id="edays" type="number" min="1" max="30" value="${plan.days}" required></div></div>
      ${isTrip ? '' : `<label class="inline"><input type="checkbox" id="epub" ${plan.is_public ? 'checked' : ''}> ${t('makePublic')}</label>`}
      <div class="err" id="eerr"></div><button class="btn primary">${t('save2')}</button></form>` : ''}
    ${items.some((i) => i.lat != null) ? `<div class="map" id="pm" style="height:300px;margin-bottom:18px"></div>` : ''}
    <div class="bar"><b>${t('estTotal1')}: ≈ ${fmtMoney(total, cur)}</b></div>
    ${dayList.map((d) => `<div class="day-block"><h3>${d === 0 ? '📥 ' + t('notScheduled') : '📅 ' + t('dayN', { n: d }) + (plan.start_date ? ' · ' + esc(fmtDate(addDays(plan.start_date, d - 1))) : '')}</h3>
      ${(byDay[d] || []).map(itemRow).join('') || `<div class="meta">${t('emptyDay')}</div>`}</div>`).join('')}
    ${owner ? `<form id="af" class="panel stack" style="max-width:640px"><b>${t('addExperience')}</b>
      <select id="alisting" required><option value="">${t('chooseListing')}</option></select>
      <select id="aday">${dayOptions(plan, isTrip ? 0 : 1, isTrip)}</select>
      <input id="anote" placeholder="${t('noteOpt')}" maxlength="300"><div class="err" id="aerr"></div><button class="btn primary">${t('addBtn')}</button></form>` : ''}`;

  const pts = items.filter((i) => i.lat != null);
  if (pts.length) {
    const m = L.map('pm'); osmTiles(m);
    pts.forEach((i) => L.marker([i.lat, i.lng]).addTo(m).bindPopup(`<b>${esc(i.title)}</b>`));
    m.fitBounds(pts.map((i) => [i.lat, i.lng]), { padding: [40, 40], maxZoom: 11 });
  }
  const reload = () => planPage(id);
  $('#plan')?.addEventListener('click', () => {
    if (!state.user) return (location.hash = '#/login');
    openDialog(`<h2 style="margin-top:0">🧳 ${t('planThis')}</h2><p class="meta">${t('planThisHelp')}</p>
      <label>${t('startDate')}</label><input id="cstart" type="date" min="${new Date().toISOString().slice(0, 10)}" required><div class="err" id="cerr"></div>
      <div class="actions" style="margin-top:12px"><button class="btn primary" id="cok">${t('create')}</button><button class="btn" id="cno">${t('close')}</button></div>`, (dlg) => {
      $('#cno', dlg).onclick = () => dlg.close();
      $('#cok', dlg).onclick = async () => {
        try { const r = await api(`/plans/${id}/copy`, { method: 'POST', body: { start_date: $('#cstart', dlg).value } }); dlg.close(); toast(t('tripCreated')); location.hash = '#/trip/' + r.id; }
        catch (err) { $('#cerr', dlg).textContent = err.message; }
      };
    });
  });
  if (!owner) return;
  $('#editp').onclick = () => { const f = $('#ef'); f.style.display = f.style.display === 'none' ? 'flex' : 'none'; };
  $('#ef').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/plans/' + id, { method: 'PUT', body: { title: $('#etitle').value, description: $('#edesc').value, start_date: $('#estart')?.value, days: $('#edays').value, is_public: $('#epub')?.checked } }); toast(t('savedToast')); reload(); }
    catch (err) { $('#eerr').textContent = err.message; }
  };
  $('#delp').onclick = async () => { if (confirm(t('confirmDelPlan'))) { await api('/plans/' + id, { method: 'DELETE' }); location.hash = isTrip ? '#/trips' : '#/collections'; } };
  api('/listings?sort=newest&cur=' + cur).then(({ listings }) => {
    $('#alisting').insertAdjacentHTML('beforeend', listings.map((l) => `<option value="${l.id}">${esc(l.title)} — ${esc(l.city)}</option>`).join(''));
  });
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/plans/${id}/items`, { method: 'POST', body: { listing_id: $('#alisting').value, day: $('#aday').value, note: $('#anote').value } }); reload(); }
    catch (err) { $('#aerr').textContent = err.message; }
  };
  app.onchange = async (e) => { const s = e.target.closest('[data-move]'); if (s) { await api('/plan-items/' + s.dataset.move, { method: 'PATCH', body: { day: s.value } }); reload(); } };
  app.onclick = async (e) => { const r = e.target.closest('[data-rm]'); if (r) { await api('/plan-items/' + r.dataset.rm, { method: 'DELETE' }); reload(); } };
}

// ---------- "add to a trip" panel on a listing page ----------
async function tripPanel(el, listingId) {
  if (!state.user) { el.innerHTML = `<b>🧳 ${t('addToTrip')}</b><div style="margin-top:8px"><a class="btn" href="#/login">${t('nav.login')}</a></div>`; return; }
  const { plans } = await api('/plans?mine=1&kind=trip');
  el.innerHTML = `<form class="stack" id="tp"><b>🧳 ${t('addToTrip')}</b>
    <select id="ptrip"><option value="">${t('chooseTrip')}</option>${plans.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}<option value="new">${t('newTripOpt')}</option></select>
    <div id="pnew" class="stack" style="display:none"><input id="pname" placeholder="${t('trips.namePh')}" maxlength="120">
      <input id="pdays" type="number" min="1" max="30" value="3" aria-label="${t('daysCount')}"></div>
    <select id="pday" style="display:none"></select><div class="err" id="perr"></div>
    <button class="btn" id="pgo">${t('addBtn')}</button></form>`;
  const pday = $('#pday', el);
  $('#ptrip', el).onchange = (e) => {
    const v = e.target.value, p = plans.find((x) => x.id === +v);
    $('#pnew', el).style.display = v === 'new' ? 'flex' : 'none';
    pday.style.display = p ? '' : 'none';
    if (p) pday.innerHTML = dayOptions(p, 0);
  };
  $('#tp', el).onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#ptrip', el).value;
    if (!v) return;
    try {
      let tripId = v, day = pday.value || 0;
      if (v === 'new') { tripId = (await api('/plans', { method: 'POST', body: { kind: 'trip', title: $('#pname', el).value, days: $('#pdays', el).value } })).id; day = 0; }
      await api(`/plans/${tripId}/items`, { method: 'POST', body: { listing_id: listingId, day } });
      toast(t('addedToTrip')); tripPanel(el, listingId);
    } catch (err) { $('#perr', el).textContent = err.message; }
  };
}

// ---------- public host profile ----------
async function hostPage(id) {
  const { host, listings } = await api('/hosts/' + id);
  app.innerHTML = `<div class="profile"><div class="avatar">${esc([...host.name][0] || '?')}</div>
    <div><h1 style="margin:0">${esc(host.name)}</h1>
      <div class="meta">${t('memberSince', { d: fmtDate(host.created_at.slice(0, 10), { month: 'long', year: 'numeric' }) })} · ${t('nExperiences', { n: host.listing_count })}</div>
      <div>${host.rating ? stars(host.rating, host.review_count) : `<span class="meta">${t('noRatings')}</span>`}</div></div></div>
    ${host.bio ? `<p style="white-space:pre-wrap;max-width:720px">${esc(host.bio)}</p>` : ''}
    <h2>${t('hostListings')}</h2>${listings.length ? `<div class="grid">${listings.map(card).join('')}</div>` : `<div class="empty">${t('empty')}</div>`}`;
  bindHearts(app);
}

// ---------- trip planner: answer a few questions, get a day-by-day itinerary ----------
const plannerForm = { city: '', days: 3, start_date: '', guests: 2, budget: '', interests: [], pace: 'balanced', rain: false, fitness: '' };
let plannerResult = null, plannerSeed = 1, plannerExclude = [];

async function plannerPage() {
  const f = plannerForm, cur = displayCur();
  const chip = (c) => `<label class="chipcheck"><input type="checkbox" value="${esc(c)}" ${f.interests.includes(c) ? 'checked' : ''}> ${ICON[c] || ''} ${esc(catName(c))}</label>`;
  const sel = (id, arr, v) => `<select id="${id}">${arr.map(([k, text]) => `<option value="${k}" ${String(v) === String(k) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  app.innerHTML = `<div class="bar"><div><h1 style="margin:0">✨ ${t('planner.title')}</h1><div class="meta">${t('planner.sub')}</div></div></div>
    <form id="pf" class="panel stack" style="max-width:760px;margin:16px 0">
      <div class="row"><div><label>${t('city')}</label><select id="pcity"><option value="">${t('planner.anyCity')}</option>${state.meta.cities.map((c) => `<option ${c === f.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div><label>${t('startDateOpt')}</label><input id="pstart" type="date" min="${new Date().toISOString().slice(0, 10)}" value="${esc(f.start_date)}"></div></div>
      <div class="row"><div><label>${t('daysCount')}</label><input id="pdays" type="number" min="1" max="14" value="${f.days}" required></div>
        <div><label>${t('planner.guests')}</label><input id="pguests" type="number" min="1" max="100" value="${f.guests}" required></div>
        <div><label>${t('planner.budget')} (${cur})</label><input id="pbudget" type="number" min="0" step="10" value="${esc(f.budget)}" placeholder="${t('planner.noLimit')}"></div></div>
      <div><label>${t('planner.interests')}</label><div class="chipset">${CATEGORIES_FOR_PLANNER().map(chip).join('')}</div></div>
      <div class="row"><div><label>${t('planner.pace')}</label>${sel('ppace', [['relaxed', t('planner.relaxed')], ['balanced', t('planner.balanced')], ['packed', t('planner.packed')]], f.pace)}</div>
        <div><label>${t('fitness')}</label>${sel('pfit', [['', t('anyFitness')], ['easy', t('fit.easy')], ['moderate', t('fit.moderate')]], f.fitness)}</div></div>
      <label class="inline"><input type="checkbox" id="prain" ${f.rain ? 'checked' : ''}> ☔ ${t('planner.rain')}</label>
      <div class="err" id="perr"></div><button class="btn primary">✨ ${t('planner.go')}</button></form>
    <div id="presult"></div>`;
  const read = () => {
    Object.assign(f, { city: $('#pcity').value, start_date: $('#pstart').value, days: $('#pdays').value, guests: $('#pguests').value, budget: $('#pbudget').value,
      interests: [...app.querySelectorAll('.chipset input:checked')].map((x) => x.value), pace: $('#ppace').value, fitness: $('#pfit').value, rain: $('#prain').checked });
  };
  const run = async () => {
    read(); $('#perr').textContent = '';
    try {
      plannerResult = await api('/planner', { method: 'POST', body: { ...f, cur: displayCur(), seed: plannerSeed, exclude: plannerExclude } });
      showPlan();
    } catch (err) { $('#perr').textContent = err.message; }
  };
  $('#pf').onsubmit = (e) => { e.preventDefault(); plannerSeed = 1; plannerExclude = []; run(); };
  app.onclick = (e) => {
    if (e.target.closest('#shuffle')) { plannerSeed = Math.floor(Math.random() * 1e9) + 1; run(); }
    const rm = e.target.closest('[data-prm]');
    if (rm) {
      const id = +rm.dataset.prm; plannerExclude.push(id);
      for (const d of plannerResult.days) d.items = d.items.filter((i) => i.listing.id !== id);
      showPlan();
    }
    if (e.target.closest('#savetrip')) saveGenerated();
  };
  if (plannerResult) showPlan();
}
const CATEGORIES_FOR_PLANNER = () => state.meta.categories.filter((c) => c !== 'Accommodation');

function showPlan() {
  const r = plannerResult, cur = r.currency, o = r.options;
  const box = $('#presult');
  if (!box) return;
  const whyText = (c) => t('why.' + c);
  const total = r.days.reduce((s, d) => s + d.items.reduce((x, i) => x + i.cost, 0), 0);
  const warn = r.warnings.map((w) => `<div class="notice">${w.code === 'emptyDay' ? t('planner.w.emptyDay', { n: w.day }) : t('planner.w.' + w.code)}</div>`).join('');
  const pts = r.days.flatMap((d) => d.items).filter((i) => i.listing.lat != null);
  box.innerHTML = r.days.every((d) => !d.items.length)
    ? `${warn || ''}<div class="empty">${t('planner.w.noMatches')}</div>`
    : `<div class="bar"><div><h2 style="margin:0">📍 ${esc(r.city)}</h2>
        <div class="meta">${t('nDays', { n: o.days })} · ${t('planner.forGuests', { n: o.guests })} · <b>≈ ${fmtMoney(total, cur)}</b>${o.budget ? ` / ${fmtMoney(o.budget, cur)}` : ''}</div></div>
        <div class="actions"><button class="btn" id="shuffle">🔄 ${t('planner.shuffle')}</button><button class="btn primary" id="savetrip">🧳 ${t('planner.save')}</button></div></div>
      ${warn}
      ${pts.length ? `<div class="map" id="plm" style="height:280px;margin-bottom:18px"></div>` : ''}
      ${r.days.map((d) => `<div class="day-block"><h3>📅 ${t('dayN', { n: d.day })}${d.date ? ' · ' + esc(fmtDate(d.date)) : ''}
          <span class="meta"> · ≈ ${Math.round(d.items.reduce((s, i) => s + i.hours, 0) * 10) / 10} ${t('planner.hrs')} · ≈ ${fmtMoney(d.items.reduce((s, i) => s + i.cost, 0), cur)}</span></h3>
        ${d.items.map((i) => `<div class="item">${thumb(i.listing)}<div class="grow"><a href="#/listing/${i.listing.id}">${esc(i.listing.title)}</a>
          <div class="meta">${ICON[i.listing.category] || ''} ${esc(catName(i.listing.category))} · ${i.listing.duration ? esc(i.listing.duration) + ' · ' : ''}<b>≈ ${fmtMoney(i.cost, cur)}</b></div>
          ${i.why.length ? `<div class="whys">${i.why.map((w) => `<span class="why">${whyText(w)}</span>`).join('')}</div>` : ''}</div>
          <button class="btn sm danger" data-prm="${i.listing.id}" title="${t('removeL')}">✕</button></div>`).join('') || `<div class="meta">${t('emptyDay')}</div>`}</div>`).join('')}`;
  if (pts.length) {
    const m = L.map('plm'); osmTiles(m);
    pts.forEach((i) => L.marker([i.listing.lat, i.listing.lng]).addTo(m).bindPopup(`<b>${esc(i.listing.title)}</b>`));
    m.fitBounds(pts.map((i) => [i.listing.lat, i.listing.lng]), { padding: [40, 40], maxZoom: 12 });
  }
}

async function saveGenerated() {
  if (!state.user) return (location.hash = '#/login');
  const r = plannerResult;
  const items = r.days.flatMap((d) => d.items.map((i) => ({ listing_id: i.listing.id, day: d.day })));
  if (!items.length) return;
  try {
    const { id } = await api('/planner/save', { method: 'POST', body: { title: t('planner.tripTo', { c: r.city }), days: r.options.days, start_date: r.options.start_date || '', items } });
    toast(t('tripCreated')); location.hash = '#/trip/' + id;
  } catch (err) { toast(err.message); }
}
