// Trip planner: builds a day-by-day itinerary from live listings.
// Rule based (no external service): it respects dates/availability, group size, budget, pace, weather and fitness.
const { checkBooking, inSeason } = require('./availability');

const PACE = { relaxed: { slots: 1, hours: 6 }, balanced: { slots: 2, hours: 9 }, packed: { slots: 3, hours: 11 } };
const LATE = new Set(['Food & Drink', 'Wellness']); // scheduled at the end of a day
const FIT = { easy: 1, moderate: 2, hard: 3 };

// Free-text duration ("3 საათი", "2.5 hours", "მთელი დღე") -> hours, with a sensible default.
function hoursOf(text) {
  const s = String(text || '').toLowerCase();
  const n = parseFloat((s.match(/\d+(?:[.,]\d+)?/) || [''])[0].replace(',', '.'));
  const hourWord = /საათ|hour|\bh\b|час|saat/.test(s);
  if (!hourWord && /დღე|day|full|whole|дн|день|gün/.test(s)) return 8;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 3;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// opts: { city, days, start_date, guests, interests[], budget, pace, rain, fitness, seed, exclude[] }
// ctx:  { listings (rows with rating/review_count), convert(amount, from) -> display currency, distanceKm }
function build(opts, ctx) {
  const pace = PACE[opts.pace] || PACE.balanced;
  const rand = mulberry32(opts.seed || 1);
  const interests = new Set(opts.interests);
  const maxFit = FIT[opts.fitness] || 3;
  const warnings = [];
  const dated = !!opts.start_date;

  let pool = ctx.listings.filter((l) =>
    l.category !== 'Accommodation' && !opts.exclude.includes(l.id) &&
    (!l.max_group || opts.guests <= l.max_group) && (!opts.rain || l.rain_ok) && (!l.fitness || FIT[l.fitness] <= maxFit));

  // No city chosen: use the city whose listings fit the interests best.
  let city = opts.city;
  if (!city) {
    const sums = {};
    for (const l of pool) sums[l.city] = (sums[l.city] || 0) + (interests.size && !interests.has(l.category) ? 0.3 : 1) + (l.rating || 3) / 10;
    city = Object.keys(sums).sort((a, b) => sums[b] - sums[a])[0] || '';
  }
  // "Pick the best for me" may also draw on nearby towns (within ~80 km of the chosen city's listings).
  const home = pool.filter((l) => l.city === city && l.lat != null);
  const near = opts.city || !home.length ? null : { lat: home.reduce((a, l) => a + l.lat, 0) / home.length, lng: home.reduce((a, l) => a + l.lng, 0) / home.length };
  pool = pool.filter((l) => l.city === city || (near && l.lat != null && ctx.distanceKm(near, l) <= 80));
  if (!pool.length) return { city, days: [], total: 0, warnings: [{ code: 'noMatches' }] };
  if (!dated) warnings.push({ code: 'noDates' });

  const cost = (l, hours) => ctx.convert((l.price_unit === 'person' ? opts.guests : l.price_unit === 'hour' ? Math.ceil(hours) : 1) * l.price, l.currency);
  const used = new Set();
  const days = [];
  let spent = 0;

  for (let d = 1; d <= opts.days; d++) {
    const date = dated ? addDays(opts.start_date, d - 1) : null;
    const left = opts.days - d + 1;
    const softCap = opts.budget ? Math.max(0, opts.budget - spent) / left * 1.5 : Infinity;
    const picks = [];
    let hours = 0, dayCost = 0;

    while (picks.length < pace.slots) {
      const last = picks[picks.length - 1];
      let best = null;
      for (const l of pool) {
        if (used.has(l.id)) continue;
        const h = hoursOf(l.duration);
        if (hours + h > pace.hours && picks.length) continue;
        const c = cost(l, h);
        if (opts.budget && (spent + dayCost + c > opts.budget || dayCost + c > softCap)) continue;
        if (date && (checkBooking(l, date, opts.guests) !== null)) continue;
        if (!date && opts.month && !inSeason(l, opts.month)) continue;
        const want = !interests.size || interests.has(l.category);
        let score = (want ? 3 : 0.4) + (l.rating || 3.5) / 5 * 1.5 + Math.min(l.review_count || 0, 10) / 20 + rand() * 0.7;
        if (picks.some((p) => p.l.category === l.category)) score -= 1.5;
        let km = null;
        if (last && last.l.lat != null && l.lat != null) { km = ctx.distanceKm(last.l, l); score -= Math.min(km / 25, 2); }
        if (!best || score > best.score) best = { l, h, c, score, km, want };
      }
      if (!best) break;
      used.add(best.l.id); hours += best.h; dayCost += best.c;
      const why = [];
      if (interests.size && best.want) why.push('interest');
      if ((best.l.rating || 0) >= 4.5 && best.l.review_count) why.push('topRated');
      if (opts.rain && best.l.rain_ok) why.push('rainOk');
      if (best.km !== null && best.km < 15) why.push('nearPrev');
      picks.push({ l: best.l, hours: best.h, cost: best.c, why });
    }
    // Daytime things first, dinner / spa last; otherwise keep a short hop between stops.
    picks.sort((a, b) => LATE.has(a.l.category) - LATE.has(b.l.category));
    spent += dayCost;
    days.push({ day: d, date, hours, cost: dayCost, items: picks.map((p) => ({ listing: p.l, hours: p.hours, cost: p.cost, why: p.why })) });
    if (!picks.length) warnings.push({ code: 'emptyDay', day: d });
  }
  if (days.every((x) => !x.items.length)) return { city, days, total: 0, warnings: [{ code: 'noMatches' }] };
  if (opts.budget && spent > opts.budget) warnings.push({ code: 'overBudget' });
  return { city, days, total: spent, warnings };
}

module.exports = { build, hoursOf, PACE };
