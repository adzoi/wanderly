# Wanderly

Marketplace for local tourism services (Node + Express + SQLite, vanilla JS front end). Georgian, English, Russian, Turkish.

```bash
npm install
npm start          # http://localhost:3000   (npm run dev restarts on file changes)
npm run reseed     # WIPES the database and loads fresh demo data (password for demo hosts: demo-pass-123)
```

Requires Node 22+.

## Email notifications
Hosts get an email for each new booking request or guest cancellation; guests get one when a booking is confirmed (with the
meeting point) or declined. Without configuration emails are only logged to the console and the `emails` table.
To send real mail set:

| Variable | Example |
|---|---|
| `SMTP_URL` | `smtps://user:password@smtp.example.com` |
| `MAIL_FROM` | `Wanderly <hello@example.com>` |
| `APP_URL` | `https://wanderly.example.com` (used for links in emails) |

## Currency
Prices are shown in the visitor's currency (GEL, USD, EUR, RUB, TRY) using live rates from open.er-api.com, cached for 6 hours.
If the rate service is unreachable, rough built-in rates are used and the listing page says so.

## Reviews, translations, password reset
- A guest can review a listing only after a **confirmed booking whose date has passed**; hosts can reply to reviews.
- Hosts can add optional **translations** of the title and description (Georgian, English, Russian, Turkish). Visitors get their language, then English, then the original text.
- **Password reset** sends a one-hour, single-use link by email. With no `SMTP_URL` configured, the link is printed in the server console and stored in the `emails` table, so you can test it locally.
- **Date search:** "Free on" (and guests) on the browse page shows only listings that are open that day with room for the party.

## Trip planner

`#/planner` builds a day-by-day itinerary from live listings (city, dates, travellers, budget, interests, pace, rain/fitness). It checks availability for each date, group size and season, keeps stops close together and stays under budget. "Try another plan" reshuffles; "Save as a trip" copies it into My trips. The logic lives in `planner.js` (no external service).
