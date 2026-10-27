// Server messages are written in Georgian (the source language) and translated per request.
// Order: [ka, en, ru, tr]
const E = [
  ['გთხოვთ, ჯერ შეხვიდეთ სისტემაში', 'Please sign in first', 'Сначала войдите в систему', 'Lütfen önce giriş yapın'],
  ['სათაური მინიმუმ 4 სიმბოლოს უნდა შეიცავდეს', 'Title must be at least 4 characters', 'Название должно содержать не менее 4 символов', 'Başlık en az 4 karakter olmalı'],
  ['აირჩიეთ კატეგორია', 'Choose a category', 'Выберите категорию', 'Bir kategori seçin'],
  ['აღწერა მინიმუმ 20 სიმბოლოს უნდა შეიცავდეს', 'Description must be at least 20 characters', 'Описание должно содержать не менее 20 символов', 'Açıklama en az 20 karakter olmalı'],
  ['მიუთითეთ სწორი ფასი', 'Enter a valid price', 'Укажите корректную цену', 'Geçerli bir fiyat girin'],
  ['ვალუტა არ არის მხარდაჭერილი', 'Unsupported currency', 'Валюта не поддерживается', 'Desteklenmeyen para birimi'],
  ['ფასის ერთეული არასწორია', 'Invalid price unit', 'Неверная единица цены', 'Geçersiz fiyat birimi'],
  ['ქალაქი სავალდებულოა', 'City is required', 'Укажите город', 'Şehir gerekli'],
  ['კოორდინატები არასწორია', 'Invalid coordinates', 'Неверные координаты', 'Geçersiz koordinatlar'],
  ['სურათის მისამართი არასწორია', 'Image must be a URL', 'Неверный адрес изображения', 'Geçersiz görsel adresi'],
  ['სახელი სავალდებულოა', 'Name is required', 'Укажите имя', 'Ad gerekli'],
  ['მიუთითეთ სწორი ელფოსტა', 'Enter a valid email', 'Укажите корректный адрес эл. почты', 'Geçerli bir e-posta girin'],
  ['პაროლი მინიმუმ 8 სიმბოლოსგან უნდა შედგებოდეს', 'Password must be at least 8 characters', 'Пароль должен содержать не менее 8 символов', 'Şifre en az 8 karakter olmalı'],
  ['ეს ელფოსტა უკვე რეგისტრირებულია', 'Email already registered', 'Этот адрес уже зарегистрирован', 'Bu e-posta zaten kayıtlı'],
  ['ელფოსტა ან პაროლი არასწორია', 'Wrong email or password', 'Неверная почта или пароль', 'E-posta veya şifre hatalı'],
  ['ვერ მოიძებნა', 'Not found', 'Не найдено', 'Bulunamadı'],
  ['ეს განცხადება თქვენ არ გეკუთვნით', 'Not your listing', 'Это не ваше объявление', 'Bu ilan size ait değil'],
  ['საკუთარ განცხადებას ვერ შეაფასებთ', "You can't review your own listing", 'Нельзя оценивать собственное объявление', 'Kendi ilanınızı değerlendiremezsiniz'],
  ['შეფასება უნდა იყოს 1-დან 5-მდე', 'Rating must be 1–5', 'Оценка должна быть от 1 до 5', 'Puan 1 ile 5 arasında olmalı'],
  ['საკუთარი განცხადების დაჯავშნა შეუძლებელია', "You can't book your own listing", 'Нельзя бронировать собственное объявление', 'Kendi ilanınızı rezerve edemezsiniz'],
  ['აირჩიეთ მომავალი თარიღი', 'Pick a future date', 'Выберите будущую дату', 'Gelecekte bir tarih seçin'],
  ['არ არის ნებადართული', 'Not allowed', 'Не разрешено', 'İzin verilmiyor'],
  ['ატვირთეთ JPG, PNG ან WebP, მაქსიმუმ 5MB', 'Upload a JPG, PNG or WebP under 5MB', 'Загрузите JPG, PNG или WebP до 5 МБ', "5MB'a kadar JPG, PNG veya WebP yükleyin"],
  ['ფაილი ძალიან დიდია', 'File too large', 'Файл слишком большой', 'Dosya çok büyük'],
  ['სერვერის შეცდომა', 'Server error', 'Ошибка сервера', 'Sunucu hatası'],
  ['ეს თარიღი ხელმისაწვდომი არ არის', 'This date is not available', 'Эта дата недоступна', 'Bu tarih müsait değil'],
  ['ამ თარიღზე საკმარისი ადგილი არ არის', 'Not enough spots left on this date', 'На эту дату недостаточно мест', 'Bu tarihte yeterli yer kalmadı'],
  ['მაქსიმუმ 8 ფოტო', 'Up to 8 photos', 'Не более 8 фото', 'En fazla 8 fotoğraf'],
  ['აირჩიეთ მინიმუმ ერთი სამუშაო დღე', 'Choose at least one working day', 'Выберите хотя бы один рабочий день', 'En az bir çalışma günü seçin'],
  ['სათაური სავალდებულოა', 'Title is required', 'Укажите название', 'Başlık gerekli'],
  ['არასწორი თარიღი', 'Invalid date', 'Неверная дата', 'Geçersiz tarih'],
  ['დღეების რაოდენობა უნდა იყოს 1–30', 'Number of days must be 1–30', 'Количество дней должно быть от 1 до 30', 'Gün sayısı 1–30 olmalı'],
  ['არასწორი მონაცემები', 'Invalid input', 'Неверные данные', 'Geçersiz veri'],
  ['შეფასება შეგიძლიათ დასრულებული დაჯავშნის შემდეგ', 'You can review after completing a confirmed booking', 'Оставить отзыв можно после завершённого подтверждённого бронирования', 'Yorum, tamamlanmış onaylı bir rezervasyondan sonra yapılabilir'],
  ['პასუხი სავალდებულოა', 'Reply is required', 'Введите ответ', 'Yanıt gerekli'],
  ['ბმული არასწორია ან ვადაგასულია', 'This link is invalid or has expired', 'Ссылка недействительна или устарела', 'Bu bağlantı geçersiz veya süresi dolmuş'],
  ['ძალიან ბევრი მცდელობა, სცადეთ მოგვიანებით', 'Too many attempts, try again later', 'Слишком много попыток, попробуйте позже', 'Çok fazla deneme, daha sonra tekrar deneyin'],
  ['დღეების რაოდენობა უნდა იყოს 1–14', 'Number of days must be 1–14', 'Количество дней должно быть от 1 до 14', 'Gün sayısı 1–14 olmalı'],
];
const GUESTS = ['სტუმრების რაოდენობა უნდა იყოს ', 'Guests must be ', 'Количество гостей: ', 'Misafir sayısı: '];
const CODES = ['ka', 'en', 'ru', 'tr'];
const BY_KA = new Map(E.map((r) => [r[0], r]));

function translate(msg, lang) {
  const i = CODES.indexOf(lang);
  if (i <= 0) return msg;
  if (BY_KA.has(msg)) return BY_KA.get(msg)[i];
  if (msg.startsWith(GUESTS[0])) return GUESTS[i] + msg.slice(GUESTS[0].length);
  return msg;
}
module.exports = { translate, CODES };
