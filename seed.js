const crypto = require('crypto');
const db = require('./db');

if (process.argv.includes('--reset')) { db.exec('DELETE FROM users; DELETE FROM emails;'); console.log('Cleared existing data'); }
if (db.prepare('SELECT COUNT(*) c FROM listings').get().c > 0) { console.log('Already seeded (use `npm run reseed` to start over)'); process.exit(0); }

const salt = crypto.randomBytes(16).toString('hex');
const hash = `${salt}:${crypto.scryptSync('demo-pass-123', salt, 64).toString('hex')}`;
const host = (name, email, bio) => Number(db.prepare('INSERT INTO users (name,email,password_hash,bio) VALUES (?,?,?,?)').run(name, email, hash, bio).lastInsertRowid);
const nino = host('ნინო', 'nino@example.com', 'თბილისელი გიდი და კერამიკოსი. მიყვარს ქალაქის ისტორიების მოყოლა და სტუმრებისთვის ქართული სუფრის გაცნობა.');
const giorgi = host('გიორგი', 'giorgi@example.com', 'ყაზბეგში გაზრდილი მთის გიდი, 10 წელზე მეტია მთაში ვმუშაობ. უსაფრთხოება ჩემთვის პირველია.');
const mari = host('მარი', 'mari@example.com', 'ვაწყობ ტურებსა და ტრანსფერებს მთელ საქართველოში. ბათუმიდან კახეთამდე ყველაფერს ვიცნობ.');

// Defaults for the optional fields; each listing overrides what it needs.
const base = { address: '', duration: '', max_group: null, languages: '', season_from: 0, season_to: 0, rain_ok: 0, rain_note: '',
  fitness: '', min_age: null, licensed: 0, safety_notes: '', meet_lat: null, meet_lng: null, meet_note: '', weekdays: '0123456', daily_capacity: null, translations: null };
const listings = [
  { host: nino, title: 'ელექტრო ველოსიპედით ტური ძველ თბილისში', category: 'Tours & Excursions', price: 65, currency: 'GEL', price_unit: 'person', city: 'თბილისი',
    description: 'გაიარეთ გოგირდის აბანოები, ნარიქალა და ძველი თბილისის დაფარული ეზოები კომფორტულ ელექტრო ველოსიპედზე. ფასში შედის ჩაფხუტი, წყალი და დეგუსტაციის გაჩერება.',
    address: 'შეხვედრა თავისუფლების მოედანზე', lat: 41.6938, lng: 44.8015, duration: '3 საათი', max_group: 8, languages: 'ქართული, ინგლისური',
    season_from: 3, season_to: 11, fitness: 'easy', min_age: 12, safety_notes: 'ჩაფხუტი სავალდებულოა და გადაგეცემათ ადგილზე. წვიმიან ამინდში ტური გადაიდება.',
    meet_lat: 41.6933, meet_lng: 44.8018, meet_note: 'ველოსიპედებით დაგხვდებით თავისუფლების მოედანზე, ოქროს ქანდაკების ქვეშ. ეძებეთ მწვანე მაისური.', daily_capacity: 16 },
  { host: nino, title: 'ხინკლისა და ჩურჩხელას მასტერკლასი', category: 'Food & Drink', price: 90, currency: 'GEL', price_unit: 'person', city: 'თბილისი',
    description: 'ადგილობრივ დიასახლისთან ერთად დაკეცეთ საკუთარი ხინკალი და ისწავლეთ ჩურჩხელას დამზადება. დასასრულს — გრძელი სადილი და სახლის ღვინო.',
    address: 'სოლოლაკის უბანი', lat: 41.6911, lng: 44.8052, duration: '4 საათი', max_group: 6, languages: 'ქართული, ინგლისური, რუსული',
    rain_ok: 1, rain_note: 'მთლიანად შენობაში ტარდება — ამინდზე არ არის დამოკიდებული.', fitness: 'easy', weekdays: '023456',
    meet_lat: 41.6907, meet_lng: 44.8049, meet_note: 'ლურჯი ჭიშკარი, მე-2 სართული. ზარი: „ნინო“.', daily_capacity: 12 },
  { host: giorgi, title: 'მთის ველოსიპედების გაქირავება — ყაზბეგი', category: 'Rentals', price: 55, currency: 'GEL', price_unit: 'day', city: 'ყაზბეგი',
    description: 'სრულად ამორტიზებული მთის ველოსიპედები ჩაფხუტითა და რუკით გერგეტის სამებამდე და მის იქითაც. შეკეთების ნაკრები უფასოა.',
    address: 'სტეფანწმინდის მთავარი ქუჩა', lat: 42.6586, lng: 44.6431, duration: 'მთელი დღე', max_group: 12, languages: 'ქართული, ინგლისური',
    season_from: 5, season_to: 10, fitness: 'moderate', min_age: 14, safety_notes: 'ბილიკები ციცაბოა. უთხარით ჩვენს გუნდს თქვენი გამოცდილების შესახებ და აიღეთ თბილი ტანსაცმელი.',
    meet_lat: 42.6589, meet_lng: 44.6425, meet_note: 'ჩვენი ბაზა მთავარი მოედნის გვერდითაა, წითელი ბანერით.', daily_capacity: 12 },
  { host: giorgi, title: 'გერგეთის მყინვარზე გიდით ლაშქრობა', category: 'Adventure & Outdoors', price: 120, currency: 'GEL', price_unit: 'person', city: 'ყაზბეგი',
    description: 'ლიცენზირებული მთის გიდი აგიყვანთ გერგეთის მყინვარზე ყაზბეგის მწვერვალის ხედებით. საჭიროა საშუალო ფიზიკური მომზადება.',
    address: 'გერგეთის ბილიკის დასაწყისი', lat: 42.6637, lng: 44.6209, duration: '7 საათი', max_group: 8, languages: 'ქართული, რუსული, ინგლისური',
    season_from: 6, season_to: 9, rain_note: 'ცუდი ამინდის შემთხვევაში თარიღს უფასოდ გადავიტანთ ან შემოგთავაზებთ სოფლის კულინარიულ ტურს.',
    fitness: 'hard', min_age: 16, licensed: 1, safety_notes: 'საჭიროა სამთო ფეხსაცმელი, წყალგაუმტარი ქურთუკი და მინიმუმ 2 ლიტრი წყალი. გიდს აქვს პირველადი დახმარების ნაკრები და რადიოკავშირი.',
    meet_lat: 42.6637, meet_lng: 44.6209, meet_note: 'შევხვდებით გერგეთის სამების ბილიკის დასაწყისში, 07:30-ზე.', daily_capacity: 8 },
  { host: mari, title: 'კახეთის ღვინის მარნების ერთდღიანი ტური', category: 'Tours & Excursions', price: 85, currency: 'USD', price_unit: 'person', city: 'თელავი',
    description: 'ეწვიეთ ქვევრის ოჯახურ მარანს და დიდ ღვინის ქარხანას თელავში. ფასში შედის დეგუსტაცია, სადილი და პირადი ტრანსპორტი თბილისიდან.',
    address: 'აყვანა თბილისში', lat: 41.9198, lng: 45.4731, duration: '10 საათი', max_group: 10, languages: 'ქართული, ინგლისური',
    rain_ok: 1, rain_note: 'მარნები და სადილი ჭერქვეშ მიმდინარეობს.', fitness: 'easy', min_age: 18, safety_notes: 'ღვინის დეგუსტაცია მხოლოდ 18+ ასაკის სტუმრებისთვისაა; მძღოლი არ სვამს.',
    meet_lat: 41.7102, meet_lng: 44.7919, meet_note: 'ბუდაპეშტის ქუჩა, სასტუმრო „მარიოტის“ წინ, 09:00-ზე.', daily_capacity: 10 },
  { host: mari, title: 'ბათუმში დაისის ნაოსნობა', category: 'Adventure & Outdoors', price: 40, currency: 'EUR', price_unit: 'person', city: 'ბათუმი',
    description: 'მშვიდი ნაოსნობა შავი ზღვის სანაპიროზე სასმელებითა და ბათუმის ჰორიზონტზე დაისის ხედით.',
    address: 'ბათუმის მარინა', lat: 41.6492, lng: 41.6354, duration: '2 საათი', max_group: 12, languages: 'ქართული, ინგლისური, თურქული',
    season_from: 5, season_to: 10, fitness: 'easy', min_age: 6, licensed: 1, safety_notes: 'ბორტზე ყველასთვის არის საშველი ჟილეტები. კაპიტანს აქვს სალიცენზიო მოწმობა.',
    meet_lat: 41.6496, meet_lng: 41.6359, meet_note: 'მარინის მე-3 პირსი, კაპიტანი ლურჯ ქუდშია.', daily_capacity: 12 },
  { host: mari, title: 'ტრანსფერი: ქუთაისის აეროპორტი → ბათუმი', category: 'Transport & Transfers', price: 150, currency: 'GEL', price_unit: 'group', city: 'ქუთაისი',
    description: 'კომფორტული პირადი მანქანა და თავაზიანი მძღოლი. კარიდან კარამდე, რეისის თვალყურის დევნებით, მოთხოვნით — ბავშვის სავარძელი.',
    address: 'ქუთაისის საერთაშორისო აეროპორტი', lat: 42.1768, lng: 42.4826, duration: '2 საათი', max_group: 4, languages: 'ქართული, რუსული, ინგლისური', rain_ok: 1,
    rain_note: 'ამინდზე არ არის დამოკიდებული.', meet_lat: 42.1763, meet_lng: 42.4829, meet_note: 'მძღოლი დაგხვდებათ ჩამოსვლის დარბაზში თქვენი სახელის ფირფიტით.', daily_capacity: 4 },
  { host: nino, title: 'ქართული კერამიკის ვორქშოფი', category: 'Culture & Workshops', price: 70, currency: 'GEL', price_unit: 'person', city: 'სიღნაღი',
    description: 'სიღნაღის სტუდიაში დაამზადეთ საკუთარი ჭურჭელი ჩარხზე და გამოწვის შემდეგ წაიღეთ სახლში.',
    address: 'ძველი უბანი', lat: 41.6192, lng: 45.9226, duration: '2.5 საათი', max_group: 6, languages: 'ქართული, ინგლისური', rain_ok: 1,
    rain_note: 'სტუდიაში ტარდება.', fitness: 'easy', min_age: 8, weekdays: '12345', meet_lat: 41.6195, meet_lng: 45.9221, meet_note: 'სტუდია ძველ ქალაქში, ყვითელი კარი ეკლესიის გვერდით.', daily_capacity: 6 },
  { host: giorgi, title: 'სვანური სასტუმრო სახლი საუზმით', category: 'Accommodation', price: 110, currency: 'GEL', price_unit: 'night', city: 'მესტია',
    description: 'მყუდრო საოჯახო სასტუმრო კავკასიონის მწვერვალებთან. ხის ღუმელი, სახლში მომზადებული საუზმე და ხედი ყველა ფანჯრიდან.',
    address: 'სოფელი სეტი', lat: 43.0452, lng: 42.7279, max_group: 4, languages: 'ქართული, ინგლისური', rain_ok: 1, rain_note: 'სახლის აქტივობები ამინდზე არ არის დამოკიდებული.',
    meet_lat: 43.0449, meet_lng: 42.7283, meet_note: 'სახლი სოფლის ცენტრში, ეკლესიის გვერდითაა. მასპინძელი დაგიკავშირდებათ ჩამოსვლამდე.', daily_capacity: 2 },
];
// Optional translations: English for every listing, Russian and Turkish for a few (visitors fall back to the original text).
const TR = [
  { en: ['E-bike tour of Old Tbilisi', 'Ride past the sulfur baths, Narikala fortress and hidden courtyards of Old Tbilisi on a comfortable e-bike. Helmet, water and a tasting stop are included.'],
    ru: ['Тур на электровелосипеде по старому Тбилиси', 'Прокатитесь мимо серных бань, крепости Нарикала и скрытых двориков старого Тбилиси на удобном электровелосипеде. В стоимость входят шлем, вода и дегустация.'],
    tr: ['Eski Tiflis’te e-bisiklet turu', 'Rahat bir e-bisikletle Eski Tiflis’in kükürtlü hamamlarının, Narikala Kalesi’nin ve gizli avlularının yanından geçin. Kask, su ve tadım molası dahildir.'] },
  { en: ['Khinkali & churchkhela masterclass', 'Fold your own khinkali dumplings with a local home cook and learn to make churchkhela. Finish with a long lunch and house wine.'],
    ru: ['Мастер-класс: хинкали и чурчхела', 'Слепите собственные хинкали вместе с местной хозяйкой и научитесь готовить чурчхелу. В конце — долгий обед и домашнее вино.'],
    tr: ['Hinkali ve çurçhela ustalık sınıfı', 'Yerel bir ev hanımıyla kendi hinkalilerinizi yapın ve çurçhela yapmayı öğrenin. Uzun bir öğle yemeği ve ev şarabıyla bitirin.'] },
  { en: ['Mountain bike rental — Kazbegi', 'Full-suspension mountain bikes with helmet and map to Gergeti Trinity Church and beyond. Repair kit included.'] },
  { en: ['Guided hike to Gergeti Glacier', 'A licensed mountain guide leads you up to Gergeti Glacier with views of Mt. Kazbek. Moderate fitness required.'],
    ru: ['Поход к леднику Гергети с гидом', 'Лицензированный горный гид поднимет вас к леднику Гергети с видом на Казбек. Требуется средняя физическая подготовка.'],
    tr: ['Gergeti Buzulu’na rehberli yürüyüş', 'Lisanslı bir dağ rehberi sizi Kazbek manzarasıyla Gergeti Buzulu’na çıkarır. Orta düzey kondisyon gerekir.'] },
  { en: ['Kakheti wine cellar day trip', 'Visit a family qvevri cellar and a large winery in Telavi. Tastings, lunch and private transport from Tbilisi are included.'] },
  { en: ['Sunset sailing in Batumi', 'A relaxed sail along the Black Sea coast with drinks on board and sunset views of the Batumi skyline.'] },
  { en: ['Transfer: Kutaisi Airport → Batumi', 'Comfortable private car with a friendly driver. Door to door, flight tracking, child seat on request.'] },
  { en: ['Georgian pottery workshop', 'Throw your own pot on the wheel in a Sighnaghi studio and take it home after firing.'] },
  { en: ['Svaneti guesthouse with breakfast', 'A cosy family guesthouse beneath the Caucasus peaks. Wood stove, homemade breakfast and a view from every window.'] },
];
listings.forEach((l, i) => {
  l.translations = JSON.stringify(Object.fromEntries(Object.entries(TR[i]).map(([code, [title, description]]) => [code, { title, description }])));
});
const cols = ['host_id', 'title', 'category', 'description', 'price', 'currency', 'price_unit', 'city', 'address', 'lat', 'lng', 'duration', 'max_group', 'languages',
  'season_from', 'season_to', 'rain_ok', 'rain_note', 'fitness', 'min_age', 'licensed', 'safety_notes', 'meet_lat', 'meet_lng', 'meet_note', 'weekdays', 'daily_capacity', 'translations'];
const ins = db.prepare(`INSERT INTO listings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
for (const l of listings) { const row = { ...base, ...l, host_id: l.host }; ins.run(...cols.map((c) => row[c])); }

const rev = db.prepare('INSERT INTO reviews (listing_id,user_id,rating,comment) VALUES (?,?,?,?)');
rev.run(1, giorgi, 5, 'შესანიშნავი გიდი, ძალიან მომეწონა დაფარული ეზოები.'); rev.run(1, mari, 4, 'სახალისო და კარგად ორგანიზებული.');
rev.run(2, giorgi, 5, 'ყველაზე გემრიელი ხინკალი, რაც კი გამიკეთებია!'); rev.run(5, nino, 5, 'დაუვიწყარი ღვინო და საჭმელი.');
// Reviews are only allowed after a completed, confirmed booking, so give each demo review one.
const past = db.prepare("INSERT INTO bookings (listing_id,user_id,date,guests,status) VALUES (?,?,'2026-08-12',2,'confirmed')");
[[1, giorgi], [1, mari], [2, giorgi], [5, nino]].forEach(([l, u]) => past.run(l, u));

const plan = db.prepare("INSERT INTO plans (owner_id, kind, title, description, days, is_public) VALUES (?, 'collection', ?, ?, ?, 1)");
const item = db.prepare('INSERT INTO plan_items (plan_id, listing_id, day, note) VALUES (?,?,?,?)');
let p = Number(plan.run(mari, '3 დღე თბილისში და კახეთში', 'ქალაქის ტემპი, ქართული სუფრა და ღვინის ქვეყანა — სამ დღეში.', 3).lastInsertRowid);
item.run(p, 1, 1, 'დაიწყეთ ქალაქის გაცნობით.'); item.run(p, 2, 2, 'დასასვენებელი, გემრიელი დღე.'); item.run(p, 5, 3, 'ადრე დილით გასვლა — მოემზადეთ!');
p = Number(plan.run(giorgi, 'მთის თავგადასავალი ყაზბეგში', 'ორი დღე მთაში: ველოსიპედით და ფეხით.', 2).lastInsertRowid);
item.run(p, 3, 1, 'მოსამზადებელი დღე ველოსიპედით.'); item.run(p, 4, 2, 'მთავარი გამოწვევა — მყინვარი.');
console.log('Seeded 3 demo hosts (password: demo-pass-123),', listings.length, 'listings and 2 collections');
