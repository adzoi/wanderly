// Live exchange rates (units of currency per 1 USD), cached; falls back to rough static values offline.
const DISPLAY = ['GEL', 'USD', 'EUR', 'RUB', 'TRY'];
const FALLBACK = { USD: 1, GEL: 2.7, EUR: 0.92, RUB: 90, TRY: 34 };
const TTL = 6 * 3600e3, RETRY = 10 * 60e3;
let cache = { rates: FALLBACK, live: false, updated: null };
let lastTry = 0;

async function refresh() {
  lastTry = Date.now();
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    if (j.result !== 'success') return;
    const rates = {};
    for (const c of DISPLAY) if (typeof j.rates?.[c] === 'number') rates[c] = j.rates[c];
    if (DISPLAY.every((c) => rates[c] > 0)) cache = { rates, live: true, updated: new Date().toISOString() };
  } catch { /* keep the previous rates */ }
}

function current() {
  const age = cache.updated ? Date.now() - Date.parse(cache.updated) : Infinity;
  if (age > TTL && Date.now() - lastTry > RETRY) refresh();
  return { ...cache, currencies: DISPLAY };
}
module.exports = { current, refresh, DISPLAY };
