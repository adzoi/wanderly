const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { translate, CODES } = require('./errors');
const rates = require('./rates');
const { monthAvailability, checkBooking, today } = require('./availability');
const { notify, sendReset } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const CATEGORIES = [
  'Tours & Excursions', 'Food & Drink', 'Rentals', 'Adventure & Outdoors',
  'Culture & Workshops', 'Transport & Transfers', 'Wellness', 'Accommodation',
];
const UNITS = ['person', 'group', 'day', 'hour', 'night'];
const CURRENCIES = ['GEL', 'USD', 'EUR'];
const FITNESS = ['easy', 'moderate', 'hard'];

app.use(express.json({ limit: '100kb' }));
// Translate error messages to the language the client asked for (X-Lang header).
app.use('/api', (req, res, next) => {
  const lang = CODES.includes(req.headers['x-lang']) ? req.headers['x-lang'] : 'ka';
  req.lang = lang;
  const json = res.json.bind(res);
  res.json = (body) => json(body && typeof body.error === 'string' ? { ...body, error: translate(body.error, lang) } : body);
  next();
});
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const checkPassword = (pw, stored) => {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 64), Buffer.from(hash, 'hex'));
};
const cookie = (req, name) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

function currentUser(req) {
  const token = cookie(req, 'sid');
  if (!token) return null;
  return db.prepare(
    'SELECT u.id, u.name, u.email, u.bio, u.lang FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).get(token) || null;
}
app.use((req, _res, next) => { req.user = currentUser(req); next(); });
const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'გთხოვთ, ჯერ შეხვიდეთ სისტემაში' });

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (res, msg) => res.status(400).json({ error: msg });
const intIn = (v, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isUrl = (u) => /^(https?:\/\/|\/uploads\/)/.test(u);
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const attempts = new Map();
function throttle(key, max = 5, windowMs = 15 * 60e3) {
  const now = Date.now();
  if (attempts.size > 5000) attempts.clear();
  const recent = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { attempts.set(key, recent); return false; }
  recent.push(now); attempts.set(key, recent);
  return true;
}
const userById = (id) => db.prepare('SELECT id, name, email, lang FROM users WHERE id = ?').get(id);

// ---------- listings: parsing ----------
// Listing text can carry optional translations; visitors get their language where one exists, else the original.
const parseTranslations = (raw) => { try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
function cleanTranslations(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const code of CODES) {
    const v = input[code];
    if (!v || typeof v !== 'object') continue;
    const title = str(v.title, 120), description = str(v.description, 4000);
    if (title || description) out[code] = { ...(title && { title }), ...(description && { description }) };
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
function localize(row, lang) {
  const { translations, ...rest } = row;
  // Fallback per field: visitor's language, then English (the common tourist language), then the original text.
  const all = parseTranslations(translations), own = all[lang] || {}, en = lang === 'ka' ? {} : all.en || {};
  const title = own.title || en.title, description = own.description || en.description;
  return { ...rest, ...(title && { title }), ...(description && 'description' in rest && { description }) };
}

const LISTING_COLS = ['title', 'category', 'description', 'price', 'currency', 'price_unit', 'city', 'address', 'lat', 'lng',
  'duration', 'max_group', 'languages', 'image', 'season_from', 'season_to', 'rain_ok', 'rain_note', 'fitness', 'min_age',
  'licensed', 'safety_notes', 'meet_lat', 'meet_lng', 'meet_note', 'weekdays', 'daily_capacity', 'translations'];

function parseListing(b) {
  const images = (Array.isArray(b.images) ? b.images : b.image ? [b.image] : []).map((u) => str(u, 500)).filter(Boolean);
  let from = intIn(b.season_from, 0, 12) || 0, to = intIn(b.season_to, 0, 12) || 0;
  if (!from || !to) from = to = 0;
  const weekdays = [...new Set(String(b.weekdays ?? '0123456').replace(/[^0-6]/g, ''))].sort().join('');
  const l = {
    title: str(b.title, 120), category: str(b.category, 40), description: str(b.description, 4000),
    price: Number(b.price), currency: str(b.currency, 3) || 'GEL', price_unit: str(b.price_unit, 10) || 'person',
    city: str(b.city, 80), address: str(b.address, 200), lat: numOrNull(b.lat), lng: numOrNull(b.lng),
    duration: str(b.duration, 60), max_group: intIn(b.max_group, 1, 10000), languages: str(b.languages, 120),
    image: images[0] || '', season_from: from, season_to: to,
    rain_ok: b.rain_ok ? 1 : 0, rain_note: str(b.rain_note, 300),
    fitness: FITNESS.includes(b.fitness) ? b.fitness : '', min_age: intIn(b.min_age, 0, 99),
    licensed: b.licensed ? 1 : 0, safety_notes: str(b.safety_notes, 1000),
    meet_lat: numOrNull(b.meet_lat), meet_lng: numOrNull(b.meet_lng), meet_note: str(b.meet_note, 1000),
    weekdays, daily_capacity: intIn(b.daily_capacity, 1, 100000),
    translations: cleanTranslations(b.translations),
  };
  if (l.title.length < 4) return { error: 'სათაური მინიმუმ 4 სიმბოლოს უნდა შეიცავდეს' };
  if (!CATEGORIES.includes(l.category)) return { error: 'აირჩიეთ კატეგორია' };
  if (l.description.length < 20) return { error: 'აღწერა მინიმუმ 20 სიმბოლოს უნდა შეიცავდეს' };
  if (!Number.isFinite(l.price) || l.price < 0) return { error: 'მიუთითეთ სწორი ფასი' };
  if (!CURRENCIES.includes(l.currency)) return { error: 'ვალუტა არ არის მხარდაჭერილი' };
  if (!UNITS.includes(l.price_unit)) return { error: 'ფასის ერთეული არასწორია' };
  if (!l.city) return { error: 'ქალაქი სავალდებულოა' };
  for (const k of ['lat', 'lng', 'meet_lat', 'meet_lng']) if (l[k] != null && !Number.isFinite(l[k])) return { error: 'კოორდინატები არასწორია' };
  if (images.length > 8) return { error: 'მაქსიმუმ 8 ფოტო' };
  if (!images.every(isUrl)) return { error: 'სურათის მისამართი არასწორია' };
  if (!weekdays) return { error: 'აირჩიეთ მინიმუმ ერთი სამუშაო დღე' };
  return { value: l, images };
}

function saveImages(listingId, images) {
  db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(listingId);
  const ins = db.prepare('INSERT INTO listing_images (listing_id, url, position) VALUES (?,?,?)');
  images.forEach((u, i) => ins.run(listingId, u, i));
}

// ---------- listings: queries ----------
const LISTING_SELECT = `
  SELECT l.*, u.name AS host_name,
    (SELECT ROUND(AVG(rating), 1) FROM reviews r WHERE r.listing_id = l.id) AS rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.listing_id = l.id) AS review_count
  FROM listings l JOIN users u ON u.id = l.host_id`;

// Meeting-point details are private until a booking is confirmed.
const stripPrivate = ({ meet_lat, meet_lng, meet_note, ...rest }) => rest;

// Great-circle distance in km.
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// SQL expression: listing price converted into the visitor's display currency.
function priceExpr(cur) {
  const { rates: r } = rates.current();
  const when = Object.entries(r).map(([c, v]) => `WHEN '${c}' THEN ${Number(v)}`).join(' ');
  return `(l.price / CASE l.currency ${when} ELSE 1 END * ${Number(r[cur] || 1)})`;
}

app.get('/api/meta', (_req, res) => {
  const cities = db.prepare("SELECT DISTINCT city FROM listings WHERE status='active' ORDER BY city").all().map((r) => r.city);
  res.json({ categories: CATEGORIES, units: UNITS, currencies: CURRENCIES, fitness: FITNESS, cities });
});
app.get('/api/rates', (_req, res) => res.json(rates.current()));

app.get('/api/listings', (req, res) => {
  const { q, category, city, min, max, sort, mine, favorites, month, rain, fitness, licensed, date } = req.query;
  const cur = rates.DISPLAY.includes(req.query.cur) ? req.query.cur : 'GEL';
  const price = priceExpr(cur);
  const where = [], args = [];
  if (mine) {
    if (!req.user) return res.status(401).json({ error: 'გთხოვთ, ჯერ შეხვიდეთ სისტემაში' });
    where.push('l.host_id = ?'); args.push(req.user.id);
  } else where.push("l.status = 'active'");
  if (favorites) {
    if (!req.user) return res.status(401).json({ error: 'გთხოვთ, ჯერ შეხვიდეთ სისტემაში' });
    where.push('l.id IN (SELECT listing_id FROM favorites WHERE user_id = ?)'); args.push(req.user.id);
  }
  if (q) {
    where.push('(l.title LIKE ? OR l.description LIKE ? OR l.city LIKE ? OR l.translations LIKE ?)');
    const like = `%${String(q).slice(0, 80)}%`; args.push(like, like, like, like);
  }
  if (category) { where.push('l.category = ?'); args.push(String(category)); }
  if (city) { where.push('l.city = ?'); args.push(String(city)); }
  if (min !== undefined && min !== '' && !isNaN(min)) { where.push(`${price} >= ?`); args.push(Number(min)); }
  if (max !== undefined && max !== '' && !isNaN(max)) { where.push(`${price} <= ?`); args.push(Number(max)); }
  const m = intIn(month, 1, 12);
  if (m) {
    where.push('(l.season_from = 0 OR l.season_to = 0 OR (l.season_from <= l.season_to AND ? BETWEEN l.season_from AND l.season_to) OR (l.season_from > l.season_to AND (? >= l.season_from OR ? <= l.season_to)))');
    args.push(m, m, m);
  }
  if (rain) where.push('l.rain_ok = 1');
  if (licensed) where.push('l.licensed = 1');
  if (FITNESS.includes(fitness)) { where.push('l.fitness = ?'); args.push(fitness); }
  // "Near me": a radius around a point (bounding box in SQL, exact distance below) and "search this map area" (bbox=south,west,north,east).
  const nlat = numOrNull(req.query.lat), nlng = numOrNull(req.query.lng);
  const origin = Number.isFinite(nlat) && Number.isFinite(nlng) && Math.abs(nlat) <= 90 && Math.abs(nlng) <= 180 ? { lat: nlat, lng: nlng } : null;
  const radius = origin && Number(req.query.radius) > 0 ? Math.min(Number(req.query.radius), 2000) : null;
  if (radius) {
    const dLat = radius / 111, dLng = radius / (111 * Math.max(Math.cos((origin.lat * Math.PI) / 180), 0.05));
    where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?');
    args.push(origin.lat - dLat, origin.lat + dLat, origin.lng - dLng, origin.lng + dLng);
  }
  const box = String(req.query.bbox || '').split(',').map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    const [south, west, north, east] = box;
    where.push('l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?');
    args.push(south, north, west, east);
  }
  const order = {
    price_asc: `${price} ASC`, price_desc: `${price} DESC`,
    rating: 'rating DESC NULLS LAST, review_count DESC', newest: 'l.created_at DESC, l.id DESC',
  }[sort] || 'l.created_at DESC, l.id DESC';
  let rows = db.prepare(`${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 200`).all(...args);
  // "Free on this date": open that day with room for the party.
  if (validDate(String(date || '')) && !mine) {
    const guests = intIn(req.query.guests, 1, 10000) || 1;
    rows = rows.filter((r) => (!r.max_group || guests <= r.max_group) && checkBooking(r, String(date), guests) === null);
  }
  const favs = req.user
    ? new Set(db.prepare('SELECT listing_id FROM favorites WHERE user_id = ?').all(req.user.id).map((r) => r.listing_id))
    : new Set();
  let out = rows.map((r) => ({
    ...localize(stripPrivate(r), req.lang), favorited: favs.has(r.id),
    ...(origin ? { distance_km: r.lat == null ? null : Math.round(distanceKm(origin, r) * 10) / 10 } : {}),
  }));
  if (radius) out = out.filter((l) => l.distance_km !== null && l.distance_km <= radius);
  if (origin && sort === 'distance') out.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
  res.json({ listings: out });
});

app.get('/api/listings/:id', (req, res) => {
  const l = db.prepare(`${LISTING_SELECT} WHERE l.id = ?`).get(req.params.id);
  if (!l || (l.status !== 'active' && l.host_id !== req.user?.id)) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  const isOwner = l.host_id === req.user?.id;
  const reviews = db.prepare(
    'SELECT r.id, r.rating, r.comment, r.created_at, r.reply, r.reply_at, u.name FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.listing_id = ? ORDER BY r.created_at DESC'
  ).all(l.id);
  const images = db.prepare('SELECT url FROM listing_images WHERE listing_id = ? ORDER BY position, id').all(l.id).map((r) => r.url);
  const favorited = !!req.user && !!db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?').get(req.user.id, l.id);
  const canReview = !!req.user && !isOwner && !!db.prepare("SELECT 1 FROM bookings WHERE listing_id=? AND user_id=? AND status='confirmed' AND date < ?").get(l.id, req.user.id, today());
  // The owner's edit form asks for the untranslated text plus the translations (?raw=1).
  const view = isOwner && req.query.raw ? { ...l, translations: parseTranslations(l.translations) } : localize(isOwner ? l : stripPrivate(l), req.lang);
  res.json({ listing: { ...view, images: images.length ? images : l.image ? [l.image] : [], favorited, is_owner: isOwner, can_review: canReview }, reviews });
});

app.post('/api/listings', requireAuth, (req, res) => {
  const { value, images, error } = parseListing(req.body);
  if (error) return bad(res, error);
  const id = db.tx(() => {
    const r = db.prepare(`INSERT INTO listings (host_id, ${LISTING_COLS.join(',')}) VALUES (?, ${LISTING_COLS.map(() => '?').join(',')})`)
      .run(req.user.id, ...LISTING_COLS.map((c) => value[c]));
    saveImages(r.lastInsertRowid, images);
    return Number(r.lastInsertRowid);
  });
  res.json({ id });
});

const ownListing = (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  if (!l) { res.status(404).json({ error: 'ვერ მოიძებნა' }); return null; }
  if (l.host_id !== req.user.id) { res.status(403).json({ error: 'ეს განცხადება თქვენ არ გეკუთვნით' }); return null; }
  return l;
};

app.put('/api/listings/:id', requireAuth, (req, res) => {
  const l = ownListing(req, res); if (!l) return;
  const { value, images, error } = parseListing(req.body);
  if (error) return bad(res, error);
  const status = req.body.status === 'paused' ? 'paused' : 'active';
  db.tx(() => {
    db.prepare(`UPDATE listings SET ${LISTING_COLS.map((c) => `${c}=?`).join(',')}, status=? WHERE id=?`)
      .run(...LISTING_COLS.map((c) => value[c]), status, l.id);
    saveImages(l.id, images);
  });
  res.json({ id: l.id });
});

app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const l = ownListing(req, res); if (!l) return;
  db.prepare('DELETE FROM listings WHERE id = ?').run(l.id);
  res.json({ ok: true });
});

// ---------- availability calendar ----------
app.get('/api/listings/:id/availability', (req, res) => {
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(req.params.id);
  const month = String(req.query.month || today().slice(0, 7));
  if (!l || (l.status !== 'active' && l.host_id !== req.user?.id)) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad(res, 'არასწორი თარიღი');
  res.json({ month, days: monthAvailability(l, month, l.host_id === req.user?.id) });
});

app.post('/api/listings/:id/blocked', requireAuth, (req, res) => {
  const l = ownListing(req, res); if (!l) return;
  const date = str(req.body.date, 10);
  if (!validDate(date)) return bad(res, 'არასწორი თარიღი');
  const removed = db.prepare('DELETE FROM blocked_dates WHERE listing_id=? AND date=?').run(l.id, date).changes;
  if (!removed) db.prepare('INSERT INTO blocked_dates (listing_id, date) VALUES (?,?)').run(l.id, date);
  res.json({ blocked: !removed });
});

// ---------- auth & profile ----------
app.post('/api/register', (req, res) => {
  const name = str(req.body.name, 60), email = str(req.body.email, 120).toLowerCase(), pw = req.body.password;
  if (!name) return bad(res, 'სახელი სავალდებულოა');
  if (!/^\S+@\S+\.\S+$/.test(email)) return bad(res, 'მიუთითეთ სწორი ელფოსტა');
  if (typeof pw !== 'string' || pw.length < 8) return bad(res, 'პაროლი მინიმუმ 8 სიმბოლოსგან უნდა შედგებოდეს');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'ეს ელფოსტა უკვე რეგისტრირებულია');
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash, lang) VALUES (?,?,?,?)')
    .run(name, email, hashPassword(pw), req.lang);
  startSession(res, lastInsertRowid);
  res.json({ user: { id: Number(lastInsertRowid), name, email, bio: '', lang: req.lang } });
});

app.post('/api/login', (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || typeof req.body.password !== 'string' || !checkPassword(req.body.password, u.password_hash))
    return res.status(401).json({ error: 'ელფოსტა ან პაროლი არასწორია' });
  db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(req.lang, u.id);
  startSession(res, u.id);
  res.json({ user: { id: u.id, name: u.name, email: u.email, bio: u.bio || '', lang: req.lang } });
});

app.post('/api/forgot', (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  if (!throttle('forgot:' + email) || !throttle('forgot-ip:' + req.ip, 20)) return res.status(429).json({ error: 'ძალიან ბევრი მცდელობა, სცადეთ მოგვიანებით' });
  const u = db.prepare('SELECT id, name, email, lang FROM users WHERE email = ?').get(email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(u.id);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), u.id, Date.now() + 3600e3);
    sendReset({ ...u, lang: req.lang }, token);
  }
  res.json({ ok: true }); // same answer whether or not the email exists
});

app.post('/api/reset', (req, res) => {
  if (!throttle('reset-ip:' + req.ip, 20)) return res.status(429).json({ error: 'ძალიან ბევრი მცდელობა, სცადეთ მოგვიანებით' });
  const pw = req.body.password;
  if (typeof pw !== 'string' || pw.length < 8) return bad(res, 'პაროლი მინიმუმ 8 სიმბოლოსგან უნდა შედგებოდეს');
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha(String(req.body.token || '')));
  if (!row || row.expires_at < Date.now()) return bad(res, 'ბმული არასწორია ან ვადაგასულია');
  db.tx(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), row.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id); // sign out everywhere
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = cookie(req, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (req.user && req.user.lang !== req.lang) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(req.lang, req.user.id);
  res.json({ user: req.user });
});

app.put('/api/me', requireAuth, (req, res) => {
  const name = str(req.body.name, 60), bio = str(req.body.bio, 600);
  if (!name) return bad(res, 'სახელი სავალდებულოა');
  db.prepare('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(name, bio, req.user.id);
  res.json({ user: { ...req.user, name, bio } });
});

app.get('/api/hosts/:id', (req, res) => {
  const host = db.prepare('SELECT id, name, bio, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!host) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  const stats = db.prepare(`SELECT COUNT(*) AS review_count, ROUND(AVG(r.rating),1) AS rating FROM reviews r
    JOIN listings l ON l.id = r.listing_id WHERE l.host_id = ?`).get(host.id);
  const listings = db.prepare(`${LISTING_SELECT} WHERE l.host_id = ? AND l.status = 'active' ORDER BY l.created_at DESC`).all(host.id).map((r) => localize(stripPrivate(r), req.lang));
  res.json({ host: { ...host, ...stats, listing_count: listings.length }, listings });
});

// ---------- reviews, favorites ----------
app.post('/api/listings/:id/reviews', requireAuth, (req, res) => {
  const l = db.prepare('SELECT host_id FROM listings WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  if (l.host_id === req.user.id) return bad(res, 'საკუთარ განცხადებას ვერ შეაფასებთ');
  const completed = db.prepare("SELECT 1 FROM bookings WHERE listing_id=? AND user_id=? AND status='confirmed' AND date < ?").get(req.params.id, req.user.id, today());
  if (!completed) return bad(res, 'შეფასება შეგიძლიათ დასრულებული დაჯავშნის შემდეგ');
  const rating = parseInt(req.body.rating, 10);
  if (!(rating >= 1 && rating <= 5)) return bad(res, 'შეფასება უნდა იყოს 1-დან 5-მდე');
  db.prepare(`INSERT INTO reviews (listing_id,user_id,rating,comment) VALUES (?,?,?,?)
    ON CONFLICT(listing_id,user_id) DO UPDATE SET rating=excluded.rating, comment=excluded.comment`)
    .run(req.params.id, req.user.id, rating, str(req.body.comment, 1000));
  res.json({ ok: true });
});

app.post('/api/reviews/:id/reply', requireAuth, (req, res) => {
  const r = db.prepare('SELECT r.id, l.host_id FROM reviews r JOIN listings l ON l.id = r.listing_id WHERE r.id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  if (r.host_id !== req.user.id) return res.status(403).json({ error: 'არ არის ნებადართული' });
  const reply = str(req.body.reply, 1000);
  if (!reply) return bad(res, 'პასუხი სავალდებულოა');
  db.prepare('UPDATE reviews SET reply = ?, reply_at = CURRENT_TIMESTAMP WHERE id = ?').run(reply, r.id);
  res.json({ ok: true });
});

app.post('/api/listings/:id/favorite', requireAuth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM listings WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  const had = db.prepare('DELETE FROM favorites WHERE user_id=? AND listing_id=?').run(req.user.id, req.params.id).changes;
  if (!had) db.prepare('INSERT INTO favorites (user_id,listing_id) VALUES (?,?)').run(req.user.id, req.params.id);
  res.json({ favorited: !had });
});

// ---------- bookings ----------
app.post('/api/listings/:id/bookings', requireAuth, (req, res) => {
  const l = db.prepare("SELECT * FROM listings WHERE id = ? AND status='active'").get(req.params.id);
  if (!l) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  if (l.host_id === req.user.id) return bad(res, 'საკუთარი განცხადების დაჯავშნა შეუძლებელია');
  const date = str(req.body.date, 10), guests = parseInt(req.body.guests, 10) || 1;
  if (!validDate(date) || date < today()) return bad(res, 'აირჩიეთ მომავალი თარიღი');
  if (guests < 1 || (l.max_group && guests > l.max_group)) return bad(res, `სტუმრების რაოდენობა უნდა იყოს 1–${l.max_group || 99}`);
  const problem = checkBooking(l, date, guests);
  if (problem === 'unavailable') return bad(res, 'ეს თარიღი ხელმისაწვდომი არ არის');
  if (problem === 'full') return bad(res, 'ამ თარიღზე საკმარისი ადგილი არ არის');
  const note = str(req.body.note, 500);
  db.prepare('INSERT INTO bookings (listing_id,user_id,date,guests,note) VALUES (?,?,?,?,?)').run(l.id, req.user.id, date, guests, note);
  const host = userById(l.host_id);
  notify('request', { recipient: host, listing: l, booking: { date, guests, note }, guest: req.user, host });
  res.json({ ok: true });
});

app.get('/api/bookings', requireAuth, (req, res) => {
  const base = `SELECT b.*, l.title, l.translations, l.price, l.currency, l.price_unit, l.city, l.address, l.meet_lat, l.meet_lng, l.meet_note,
      u.name AS guest_name, u.email AS guest_email, h.name AS host_name, l.host_id
    FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users u ON u.id=b.user_id JOIN users h ON h.id=l.host_id`;
  const made = db.prepare(`${base} WHERE b.user_id = ? ORDER BY b.date DESC`).all(req.user.id)
    .map((b) => localize(b.status === 'confirmed' ? b : stripPrivate(b), req.lang));
  const incoming = db.prepare(`${base} WHERE l.host_id = ? ORDER BY b.created_at DESC`).all(req.user.id).map((b) => localize(stripPrivate(b), req.lang));
  res.json({ made, incoming });
});

app.patch('/api/bookings/:id', requireAuth, (req, res) => {
  const b = db.prepare('SELECT b.*, l.host_id FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE b.id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  const status = req.body.status;
  const hostOk = b.host_id === req.user.id && ['confirmed', 'declined'].includes(status);
  const guestOk = b.user_id === req.user.id && status === 'cancelled';
  if (!hostOk && !guestOk) return res.status(403).json({ error: 'არ არის ნებადართული' });
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status, b.id);
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(b.listing_id);
  const guest = userById(b.user_id), host = userById(b.host_id);
  notify(status, { recipient: status === 'cancelled' ? host : guest, listing, booking: b, guest, host });
  res.json({ ok: true });
});

// ---------- plans: trips (private) and collections (shareable itineraries) ----------
const planOf = (id) => db.prepare('SELECT p.*, u.name AS owner_name FROM plans p JOIN users u ON u.id = p.owner_id WHERE p.id = ?').get(id);
const canView = (p, user) => p && (p.owner_id === user?.id || (p.kind === 'collection' && p.is_public === 1));
const ITEM_SELECT = `SELECT i.id, i.day, i.note, l.id AS listing_id, l.title, l.translations, l.price, l.currency, l.price_unit, l.city, l.image,
    l.category, l.lat, l.lng, l.status, l.duration
  FROM plan_items i JOIN listings l ON l.id = i.listing_id WHERE i.plan_id = ? ORDER BY i.day, i.id`;

function parsePlan(b, kind) {
  const title = str(b.title, 120);
  if (!title) return { error: 'სათაური სავალდებულოა' };
  const start = str(b.start_date, 10) || null;
  if (start && !validDate(start)) return { error: 'არასწორი თარიღი' };
  const days = intIn(b.days, 1, 30);
  if (!days) return { error: 'დღეების რაოდენობა უნდა იყოს 1–30' };
  return { value: { title, description: str(b.description, 1000), start_date: kind === 'trip' ? start : null, days, is_public: kind === 'collection' && b.is_public ? 1 : 0 } };
}

app.get('/api/plans', (req, res) => {
  const kind = req.query.kind === 'collection' ? 'collection' : 'trip';
  const cols = `SELECT p.*, u.name AS owner_name, (SELECT COUNT(*) FROM plan_items i WHERE i.plan_id = p.id) AS item_count,
    (SELECT GROUP_CONCAT(DISTINCT l.city) FROM plan_items i JOIN listings l ON l.id = i.listing_id WHERE i.plan_id = p.id) AS cities
    FROM plans p JOIN users u ON u.id = p.owner_id`;
  if (req.query.mine) {
    if (!req.user) return res.status(401).json({ error: 'გთხოვთ, ჯერ შეხვიდეთ სისტემაში' });
    return res.json({ plans: db.prepare(`${cols} WHERE p.owner_id = ? AND p.kind = ? ORDER BY p.created_at DESC, p.id DESC`).all(req.user.id, kind) });
  }
  res.json({ plans: db.prepare(`${cols} WHERE p.kind = 'collection' AND p.is_public = 1 ORDER BY p.created_at DESC, p.id DESC`).all() });
});

app.post('/api/plans', requireAuth, (req, res) => {
  const kind = req.body.kind === 'collection' ? 'collection' : 'trip';
  const { value, error } = parsePlan(req.body, kind);
  if (error) return bad(res, error);
  const r = db.prepare('INSERT INTO plans (owner_id, kind, title, description, start_date, days, is_public) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, kind, value.title, value.description, value.start_date, value.days, value.is_public);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.get('/api/plans/:id', (req, res) => {
  const p = planOf(req.params.id);
  if (!canView(p, req.user)) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  res.json({ plan: { ...p, is_owner: p.owner_id === req.user?.id }, items: db.prepare(ITEM_SELECT).all(p.id).map((i) => localize(i, req.lang)) });
});

const ownPlan = (req, res) => {
  const p = planOf(req.params.id);
  if (!p) { res.status(404).json({ error: 'ვერ მოიძებნა' }); return null; }
  if (p.owner_id !== req.user.id) { res.status(403).json({ error: 'არ არის ნებადართული' }); return null; }
  return p;
};

app.put('/api/plans/:id', requireAuth, (req, res) => {
  const p = ownPlan(req, res); if (!p) return;
  const { value, error } = parsePlan(req.body, p.kind);
  if (error) return bad(res, error);
  db.tx(() => {
    db.prepare('UPDATE plans SET title=?, description=?, start_date=?, days=?, is_public=? WHERE id=?')
      .run(value.title, value.description, value.start_date, value.days, value.is_public, p.id);
    db.prepare('UPDATE plan_items SET day = ? WHERE plan_id = ? AND day > ?').run(value.days, p.id, value.days);
  });
  res.json({ ok: true });
});

app.delete('/api/plans/:id', requireAuth, (req, res) => {
  const p = ownPlan(req, res); if (!p) return;
  db.prepare('DELETE FROM plans WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

app.post('/api/plans/:id/items', requireAuth, (req, res) => {
  const p = ownPlan(req, res); if (!p) return;
  const listing = db.prepare("SELECT id FROM listings WHERE id = ? AND status = 'active'").get(req.body.listing_id);
  const day = req.body.day === undefined ? 0 : intIn(req.body.day, 0, p.days);
  if (!listing || day === null) return bad(res, 'არასწორი მონაცემები');
  const r = db.prepare('INSERT INTO plan_items (plan_id, listing_id, day, note) VALUES (?,?,?,?)').run(p.id, listing.id, day, str(req.body.note, 300));
  res.json({ id: Number(r.lastInsertRowid) });
});

app.patch('/api/plan-items/:id', requireAuth, (req, res) => {
  const it = db.prepare('SELECT i.*, p.owner_id, p.days FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE i.id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  if (it.owner_id !== req.user.id) return res.status(403).json({ error: 'არ არის ნებადართული' });
  const day = req.body.day === undefined ? it.day : intIn(req.body.day, 0, it.days);
  if (day === null) return bad(res, 'არასწორი მონაცემები');
  db.prepare('UPDATE plan_items SET day = ?, note = ? WHERE id = ?').run(day, req.body.note === undefined ? it.note : str(req.body.note, 300), it.id);
  res.json({ ok: true });
});

app.delete('/api/plan-items/:id', requireAuth, (req, res) => {
  const it = db.prepare('SELECT i.id, p.owner_id FROM plan_items i JOIN plans p ON p.id = i.plan_id WHERE i.id = ?').get(req.params.id);
  if (!it) return res.status(404).json({ error: 'ვერ მოიძებნა' });
  if (it.owner_id !== req.user.id) return res.status(403).json({ error: 'არ არის ნებადართული' });
  db.prepare('DELETE FROM plan_items WHERE id = ?').run(it.id);
  res.json({ ok: true });
});

// Turn a collection into the user's own trip, starting on a chosen date.
app.post('/api/plans/:id/copy', requireAuth, (req, res) => {
  const p = planOf(req.params.id);
  if (!canView(p, req.user) || p.kind !== 'collection') return res.status(404).json({ error: 'ვერ მოიძებნა' });
  const start = str(req.body.start_date, 10);
  if (!validDate(start) || start < today()) return bad(res, 'აირჩიეთ მომავალი თარიღი');
  const id = db.tx(() => {
    const r = db.prepare('INSERT INTO plans (owner_id, kind, title, description, start_date, days, is_public) VALUES (?,?,?,?,?,?,0)')
      .run(req.user.id, 'trip', p.title, p.description, start, p.days);
    const tripId = Number(r.lastInsertRowid);
    db.prepare(`INSERT INTO plan_items (plan_id, listing_id, day, note)
      SELECT ?, i.listing_id, i.day, i.note FROM plan_items i JOIN listings l ON l.id = i.listing_id
      WHERE i.plan_id = ? AND l.status = 'active' ORDER BY i.day, i.id`).run(tripId, p.id);
    return tripId;
  });
  res.json({ id });
});

// ---------- trip planner: generate an itinerary, then save it as a trip ----------
const planner = require('./planner');
app.post('/api/planner', (req, res) => {
  const b = req.body || {};
  const cur = rates.DISPLAY.includes(b.cur) ? b.cur : 'GEL';
  const start = str(b.start_date, 10);
  if (start && (!validDate(start) || start < today())) return bad(res, 'აირჩიეთ მომავალი თარიღი');
  const days = intIn(b.days, 1, 14);
  if (!days) return bad(res, 'დღეების რაოდენობა უნდა იყოს 1–14');
  const budget = Number(b.budget) > 0 ? Number(b.budget) : null;
  const opts = {
    city: str(b.city, 80), days, start_date: start || null, guests: intIn(b.guests, 1, 100) || 1,
    interests: (Array.isArray(b.interests) ? b.interests : []).filter((c) => CATEGORIES.includes(c)),
    budget, pace: ['relaxed', 'balanced', 'packed'].includes(b.pace) ? b.pace : 'balanced',
    rain: !!b.rain, fitness: FITNESS.includes(b.fitness) ? b.fitness : '', seed: intIn(b.seed, 0, 2 ** 31) || 1,
    exclude: (Array.isArray(b.exclude) ? b.exclude : []).map(Number).filter(Number.isInteger).slice(0, 200),
  };
  const r = rates.current().rates;
  const convert = (amount, from) => (amount / (r[from] || 1)) * r[cur];
  const out = planner.build(opts, {
    listings: db.prepare(`${LISTING_SELECT} WHERE l.status = 'active'`).all(), convert, distanceKm,
  });
  const strip = ({ listing: l, ...rest }) => ({ ...rest, listing: localize(stripPrivate(l), req.lang) });
  res.json({
    city: out.city, currency: cur, total: out.total, warnings: out.warnings, options: { ...opts, cur },
    days: out.days.map((d) => ({ ...d, items: d.items.map(strip) })),
  });
});

app.post('/api/planner/save', requireAuth, (req, res) => {
  const { value, error } = parsePlan(req.body, 'trip');
  if (error) return bad(res, error);
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 100)
    .map((i) => ({ listing_id: intIn(i.listing_id, 1, 2 ** 31), day: intIn(i.day, 0, value.days) ?? 0 }));
  const id = db.tx(() => {
    const r = db.prepare('INSERT INTO plans (owner_id, kind, title, description, start_date, days, is_public) VALUES (?,?,?,?,?,?,0)')
      .run(req.user.id, 'trip', value.title, value.description, value.start_date, value.days);
    const pid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO plan_items (plan_id, listing_id, day, note) VALUES (?,?,?,?)');
    for (const i of items) if (i.listing_id && db.prepare("SELECT 1 FROM listings WHERE id = ? AND status = 'active'").get(i.listing_id)) ins.run(pid, i.listing_id, i.day, '');
    return pid;
  });
  res.json({ id });
});

// ---------- uploads ----------
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
app.post('/api/upload', requireAuth, express.raw({ type: Object.keys(EXT), limit: '5mb' }), (req, res) => {
  const ext = EXT[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'ატვირთეთ JPG, PNG ან WebP, მაქსიმუმ 5MB');
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  res.json({ url: `/uploads/${name}` });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'ვერ მოიძებნა' }));
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'ფაილი ძალიან დიდია' });
  console.error(err);
  res.status(500).json({ error: 'სერვერის შეცდომა' });
});

if (require.main === module) {
  rates.refresh();
  app.listen(PORT, () => console.log(`Wanderly running on http://localhost:${PORT}`));
}
module.exports = app;
