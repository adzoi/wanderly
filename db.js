const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'wanderly.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GEL',
  price_unit TEXT NOT NULL DEFAULT 'person',
  city TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  duration TEXT,
  max_group INTEGER,
  languages TEXT,
  image TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (listing_id, user_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, listing_id)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  guests INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings(listing_id, date);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_listing ON listing_images(listing_id, position);
CREATE TABLE IF NOT EXISTS blocked_dates (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (listing_id, date)
);
-- A plan is either a personal "trip" or a shareable "collection" (itinerary).
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('trip','collection')),
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  days INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  day INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Additive column migrations so existing databases keep working.
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('users', 'bio', 'TEXT');
addColumn('reviews', 'reply', 'TEXT');
addColumn('reviews', 'reply_at', 'TEXT');
addColumn('listings', 'translations', 'TEXT'); // JSON: { en: { title, description }, ru: {...}, ... }
addColumn('users', 'lang', "TEXT NOT NULL DEFAULT 'ka'");
for (const [c, d] of [
  ['season_from', 'INTEGER NOT NULL DEFAULT 0'], ['season_to', 'INTEGER NOT NULL DEFAULT 0'],
  ['rain_ok', 'INTEGER NOT NULL DEFAULT 0'], ['rain_note', 'TEXT'],
  ['fitness', "TEXT NOT NULL DEFAULT ''"], ['min_age', 'INTEGER'], ['licensed', 'INTEGER NOT NULL DEFAULT 0'], ['safety_notes', 'TEXT'],
  ['meet_lat', 'REAL'], ['meet_lng', 'REAL'], ['meet_note', 'TEXT'],
  ['weekdays', "TEXT NOT NULL DEFAULT '0123456'"], ['daily_capacity', 'INTEGER'],
]) addColumn('listings', c, d);

// Backfill the gallery from the old single image column.
db.exec(`INSERT INTO listing_images (listing_id, url, position)
  SELECT id, image, 0 FROM listings
  WHERE image IS NOT NULL AND image <> '' AND id NOT IN (SELECT listing_id FROM listing_images)`);

db.tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
module.exports = db;
