const db = require('./db');

const today = () => new Date().toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

// Season is stored as two months (1-12); 0 means all year. A range may wrap the new year (Nov-Mar).
function inSeason(l, month) {
  const f = l.season_from, to = l.season_to;
  if (!f || !to) return true;
  return f <= to ? month >= f && month <= to : month >= f || month <= to;
}

function dayStatus(l, date, blocked, booked) {
  const ok = date >= today() && l.weekdays.includes(String(weekday(date))) &&
    inSeason(l, Number(date.slice(5, 7))) && !blocked;
  const remaining = l.daily_capacity ? Math.max(0, l.daily_capacity - booked) : null;
  return { open: ok && (remaining === null || remaining > 0), remaining, closed: !ok };
}

function monthAvailability(l, month, includeBooked) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const blocked = new Set(db.prepare('SELECT date FROM blocked_dates WHERE listing_id=? AND date LIKE ?').all(l.id, month + '-%').map((r) => r.date));
  const bookedBy = Object.fromEntries(db.prepare(
    "SELECT date, SUM(guests) n FROM bookings WHERE listing_id=? AND date LIKE ? AND status IN ('pending','confirmed') GROUP BY date"
  ).all(l.id, month + '-%').map((r) => [r.date, r.n]));
  const days = {};
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const s = dayStatus(l, date, blocked.has(date), bookedBy[date] || 0);
    days[date] = { ...s, blocked: blocked.has(date), ...(includeBooked ? { booked: bookedBy[date] || 0 } : {}) };
  }
  return days;
}

// Returns null when the booking fits, otherwise 'unavailable' or 'full'.
function checkBooking(l, date, guests) {
  const blocked = !!db.prepare('SELECT 1 FROM blocked_dates WHERE listing_id=? AND date=?').get(l.id, date);
  const booked = db.prepare("SELECT COALESCE(SUM(guests),0) n FROM bookings WHERE listing_id=? AND date=? AND status IN ('pending','confirmed')").get(l.id, date).n;
  const s = dayStatus(l, date, blocked, booked);
  if (s.closed) return 'unavailable';
  if (l.daily_capacity && booked + guests > l.daily_capacity) return 'full';
  return null;
}
module.exports = { inSeason, monthAvailability, checkBooking, today };
