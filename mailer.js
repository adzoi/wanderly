// Email notifications. Set SMTP_URL (e.g. smtps://user:pass@smtp.example.com) to send for real;
// without it, emails are only logged and stored in the `emails` table (handy in development).
const nodemailer = require('nodemailer');
const db = require('./db');

const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const FROM = process.env.MAIL_FROM || 'Wanderly <no-reply@wanderly.local>';
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const IDX = { ka: 0, en: 1, ru: 2, tr: 3 };

// [ka, en, ru, tr]
const TEXT = {
  request: {
    subject: ['ახალი დაჯავშნის მოთხოვნა: {title}', 'New booking request: {title}', 'Новый запрос на бронирование: {title}', 'Yeni rezervasyon talebi: {title}'],
    body: ['გამარჯობა, {host}!\n\n{guest}-მა მოითხოვა „{title}“-ის დაჯავშნა.\nთარიღი: {date}\nსტუმრები: {guests}\n{note}\nდაადასტურეთ ან უარყავით კაბინეტში:\n{url}',
      'Hi {host},\n\n{guest} requested to book "{title}".\nDate: {date}\nGuests: {guests}\n{note}\nConfirm or decline in your dashboard:\n{url}',
      'Здравствуйте, {host}!\n\n{guest} запросил(а) бронирование «{title}».\nДата: {date}\nГостей: {guests}\n{note}\nПодтвердите или отклоните в кабинете:\n{url}',
      'Merhaba {host},\n\n{guest}, "{title}" için rezervasyon talep etti.\nTarih: {date}\nMisafir: {guests}\n{note}\nPanelinizden onaylayın veya reddedin:\n{url}'],
  },
  confirmed: {
    subject: ['დადასტურდა: {title}', 'Confirmed: {title}', 'Подтверждено: {title}', 'Onaylandı: {title}'],
    body: ['გამარჯობა, {guest}!\n\nთქვენი დაჯავშნა დადასტურდა.\n{title}\nთარიღი: {date}\nსტუმრები: {guests}\n{meeting}\nნახეთ კაბინეტში:\n{url}',
      'Hi {guest},\n\nYour booking is confirmed.\n{title}\nDate: {date}\nGuests: {guests}\n{meeting}\nSee it in your dashboard:\n{url}',
      'Здравствуйте, {guest}!\n\nВаше бронирование подтверждено.\n{title}\nДата: {date}\nГостей: {guests}\n{meeting}\nСмотрите в кабинете:\n{url}',
      'Merhaba {guest},\n\nRezervasyonunuz onaylandı.\n{title}\nTarih: {date}\nMisafir: {guests}\n{meeting}\nPanelinizde görüntüleyin:\n{url}'],
  },
  declined: {
    subject: ['დაჯავშნა უარყოფილია: {title}', 'Booking declined: {title}', 'Бронирование отклонено: {title}', 'Rezervasyon reddedildi: {title}'],
    body: ['გამარჯობა, {guest}!\n\nსამწუხაროდ, მასპინძელმა ვერ დაადასტურა „{title}“ ({date}). სცადეთ სხვა თარიღი ან შეთავაზება:\n{url}',
      'Hi {guest},\n\nUnfortunately the host could not confirm "{title}" on {date}. Try another date or experience:\n{url}',
      'Здравствуйте, {guest}!\n\nК сожалению, организатор не смог подтвердить «{title}» на {date}. Попробуйте другую дату или услугу:\n{url}',
      'Merhaba {guest},\n\nMaalesef sunucu "{title}" için {date} tarihini onaylayamadı. Başka bir tarih veya deneyim deneyin:\n{url}'],
  },
  cancelled: {
    subject: ['დაჯავშნა გაუქმდა: {title}', 'Booking cancelled: {title}', 'Бронирование отменено: {title}', 'Rezervasyon iptal edildi: {title}'],
    body: ['გამარჯობა, {host}!\n\n{guest}-მა გააუქმა დაჯავშნა „{title}“ ({date}, {guests} სტუმარი).\n{url}',
      'Hi {host},\n\n{guest} cancelled the booking for "{title}" ({date}, {guests} guests).\n{url}',
      'Здравствуйте, {host}!\n\n{guest} отменил(а) бронирование «{title}» ({date}, гостей: {guests}).\n{url}',
      'Merhaba {host},\n\n{guest}, "{title}" rezervasyonunu iptal etti ({date}, {guests} misafir).\n{url}'],
  },
};
const MEETING = ['შეხვედრის ადგილი', 'Meeting point', 'Место встречи', 'Buluşma noktası'];

function render(event, lang, d) {
  const i = IDX[lang] ?? 0;
  const vars = { ...d, url: `${APP_URL}/#/dashboard`, note: d.note ? `“${d.note}”\n` : '' };
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return { subject: fill(TEXT[event].subject[i]), text: fill(TEXT[event].body[i]).replace(/\n{3,}/g, '\n\n') };
}

async function send(to, subject, text, verbose) {
  let status = 'logged';
  if (transport) {
    try { await transport.sendMail({ from: FROM, to, subject, text }); status = 'sent'; } catch (e) { status = 'failed'; console.error('mail failed:', e.message); }
  } else console.log(`[mail:dev] to=${to} subject="${subject}"${verbose ? '\n' + text : ''}`);
  db.prepare('INSERT INTO emails (to_addr, subject, body, status) VALUES (?,?,?,?)').run(to, subject, text, status);
}

// event: request | confirmed | declined | cancelled. Fire-and-forget: never blocks or breaks a request.
function notify(event, { recipient, listing, booking, guest, host }) {
  try {
    const meeting = event === 'confirmed' && (listing.meet_note || listing.meet_lat != null)
      ? `${MEETING[IDX[recipient.lang] ?? 0]}: ${listing.meet_note || ''}${listing.meet_lat != null ? `\nhttps://www.google.com/maps/search/?api=1&query=${listing.meet_lat},${listing.meet_lng}` : ''}\n`
      : '';
    const { subject, text } = render(event, recipient.lang, {
      title: listing.title, date: booking.date, guests: booking.guests, note: booking.note,
      guest: guest.name, host: host.name, meeting,
    });
    send(recipient.email, subject, text).catch(() => {});
  } catch (e) { console.error('notify error', e.message); }
}
const RESET = {
  subject: ['პაროლის აღდგენა — Wanderly', 'Reset your Wanderly password', 'Восстановление пароля Wanderly', 'Wanderly şifre sıfırlama'],
  body: ['გამარჯობა, {name}!\n\nპაროლის შესაცვლელად გახსენით ბმული (მოქმედებს 1 საათი):\n{link}\n\nთუ თქვენ არ მოგითხოვიათ, უბრალოდ დააიგნორეთ ეს წერილი.',
    'Hi {name},\n\nOpen this link to choose a new password (valid for 1 hour):\n{link}\n\nIf you didn\'t ask for this, you can ignore this email.',
    'Здравствуйте, {name}!\n\nЧтобы задать новый пароль, откройте ссылку (действует 1 час):\n{link}\n\nЕсли вы не запрашивали сброс, просто проигнорируйте это письмо.',
    'Merhaba {name},\n\nYeni şifre belirlemek için bağlantıyı açın (1 saat geçerlidir):\n{link}\n\nBunu siz istemediyseniz bu e-postayı yok sayabilirsiniz.'],
};
function sendReset(user, token) {
  const i = IDX[user.lang] ?? 0, link = `${APP_URL}/#/reset/${token}`;
  const fill = (s) => s.replace('{name}', user.name).replace('{link}', link);
  send(user.email, RESET.subject[i], fill(RESET.body[i]), true).catch(() => {});
}
module.exports = { notify, sendReset };
