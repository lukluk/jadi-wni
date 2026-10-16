// Data papan & kartu — dipakai server (aturan) dan client (tampilan).
// Satuan uang: juta rupiah (jt).

export const START_MONEY = 1500;
export const SALARY = 200;
export const JAIL_FINE = 50;
export const JAIL_INDEX = 10;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;

/** Level bangunan. index = level (0 = tanah kosong). */
export const HOUSE_LEVELS = [
	{ name: 'Tanah Kosong', short: '', icon: '' },
	{ name: 'Rumah Subsidi', short: 'SUB', icon: '🏚️' },
	{ name: 'Rumah Tipe 45', short: 'T45', icon: '🏠' },
	{ name: 'Rumah Cluster', short: 'CLS', icon: '🏡' },
	{ name: 'Rumah OKB', short: 'OKB', icon: '🏰' },
	{ name: 'Kebun Sawit', short: 'SWT', icon: '🌴' }
];
export const MAX_LEVEL = HOUSE_LEVELS.length - 1;
export const SAWIT_LEVEL = MAX_LEVEL;
export const OKB_LEVEL = SAWIT_LEVEL - 1;
/** Kebun Sawit: biaya bangun x3 lipat, tapi tiap kebun menambah gaji GAJIAN */
export const SAWIT_COST_MULT = 3;
export const SAWIT_SALARY_BONUS = 30;

/** biaya membangun ke level `level` (1..MAX_LEVEL) */
export const buildCost = (houseCost, level) => (level >= SAWIT_LEVEL ? houseCost * SAWIT_COST_MULT : houseCost);
/** total biaya yang sudah ditanam sampai `level` */
export const investedCost = (houseCost, level) => {
	let total = 0;
	for (let l = 1; l <= level; l++) total += buildCost(houseCost, l);
	return total;
};

export const GROUPS = {
	coklat: { label: 'Pinggiran', color: '#8B5A2B', houseCost: 50 },
	biru: { label: 'Penyangga', color: '#7CC6E8', houseCost: 50 },
	pink: { label: 'Jawa Tengah', color: '#D6408F', houseCost: 100 },
	oranye: { label: 'Jawa Timur & Barat', color: '#F08A24', houseCost: 100 },
	merah: { label: 'Kota Besar', color: '#D7263D', houseCost: 150 },
	kuning: { label: 'Wisata', color: '#F2C230', houseCost: 150 },
	hijau: { label: 'Kawasan Elit', color: '#2E9E5B', houseCost: 200 },
	navy: { label: 'Pusat Kota', color: '#23356B', houseCost: 200 }
};

/**
 * @typedef {{ i:number, type:'start'|'property'|'station'|'utility'|'tax'|'musibah'|'takdir'|'jail'|'bansos'|'gotojail',
 *   name:string, short?:string, group?:string, price?:number, rent?:number[], amount?:number, desc?:string }} Tile
 */

/** rent: [tanah, Subsidi, Tipe45, Cluster, OKB]; sewa Kebun Sawit = 1,5x OKB */
const p = (name, group, price, rent, short) => ({
	type: 'property',
	name,
	group,
	price,
	rent: [...rent, Math.round((rent[4] * 1.5) / 5) * 5],
	short
});

/** @type {Tile[]} */
export const TILES = [
	{ type: 'start', name: 'GAJIAN', desc: `Lewat sini terima gaji Rp ${SALARY} jt (+${SAWIT_SALARY_BONUS} jt per Kebun Sawit)` },
	p('Cikarang', 'coklat', 60, [2, 10, 30, 90, 250]),
	{ type: 'takdir', name: 'Takdir' },
	p('Bekasi', 'coklat', 60, [4, 20, 60, 180, 450]),
	{ type: 'tax', name: 'Bayar PBB', amount: 200, desc: 'Pajak Bumi & Bangunan' },
	{ type: 'station', name: 'KRL Commuter', short: 'KRL', price: 200 },
	p('Depok', 'biru', 100, [6, 30, 90, 270, 550]),
	{ type: 'musibah', name: 'Musibah' },
	p('Bogor', 'biru', 100, [6, 30, 90, 270, 550]),
	p('Tangerang', 'biru', 120, [8, 40, 100, 300, 600]),
	{ type: 'jail', name: 'Ruang Sidang Tilang', short: 'Sidang', desc: 'Cuma lewat, aman.' },
	p('Semarang', 'pink', 140, [10, 50, 150, 450, 750]),
	{ type: 'utility', name: 'PLN', price: 150 },
	p('Solo', 'pink', 140, [10, 50, 150, 450, 750]),
	p('Yogyakarta', 'pink', 160, [12, 60, 180, 500, 900], 'Jogja'),
	{ type: 'station', name: 'Transjakarta', short: 'TJ', price: 200 },
	p('Malang', 'oranye', 180, [14, 70, 200, 550, 950]),
	{ type: 'takdir', name: 'Takdir' },
	p('Surabaya', 'oranye', 180, [14, 70, 200, 550, 950]),
	p('Bandung', 'oranye', 200, [16, 80, 220, 600, 1000]),
	{ type: 'bansos', name: 'Bansos Cair', short: 'Bansos', desc: 'Ambil semua uang di Kas Negara' },
	p('Medan', 'merah', 220, [18, 90, 250, 700, 1050]),
	{ type: 'musibah', name: 'Musibah' },
	p('Makassar', 'merah', 220, [18, 90, 250, 700, 1050]),
	p('Balikpapan', 'merah', 240, [20, 100, 300, 750, 1100], 'Bpp'),
	{ type: 'station', name: 'MRT Jakarta', short: 'MRT', price: 200 },
	p('Denpasar', 'kuning', 260, [22, 110, 330, 800, 1150]),
	p('Labuan Bajo', 'kuning', 260, [22, 110, 330, 800, 1150], 'L. Bajo'),
	{ type: 'utility', name: 'PDAM', price: 150 },
	p('Raja Ampat', 'kuning', 280, [24, 120, 360, 850, 1200], 'R. Ampat'),
	{ type: 'gotojail', name: 'Kena Razia!', short: 'Razia', desc: 'Langsung ke Ruang Sidang Tilang' },
	p('BSD', 'hijau', 300, [26, 130, 390, 900, 1275]),
	p('PIK', 'hijau', 300, [26, 130, 390, 900, 1275]),
	{ type: 'takdir', name: 'Takdir' },
	p('Kemang', 'hijau', 320, [28, 150, 450, 1000, 1400]),
	{ type: 'station', name: 'Whoosh', short: 'Whoosh', price: 200 },
	{ type: 'musibah', name: 'Musibah' },
	p('Menteng', 'navy', 350, [35, 175, 500, 1100, 1500]),
	{ type: 'tax', name: 'PPN Barang Mewah', short: 'PPnBM', amount: 100, desc: 'Gaya hidup ada harganya' },
	p('SCBD', 'navy', 400, [50, 200, 600, 1400, 2000])
].map((t, i) => ({ ...t, i }));

/** gaji GAJIAN pemain: dasar + bonus per Kebun Sawit */
export const salaryFor = (tiles, playerId) => {
	let sawit = 0;
	for (const [i, t] of Object.entries(tiles))
		if (t.owner === playerId && TILES[+i].type === 'property' && t.level === SAWIT_LEVEL) sawit += 1;
	return { sawit, bonus: sawit * SAWIT_SALARY_BONUS, amount: SALARY + sawit * SAWIT_SALARY_BONUS };
};

export const STATION_RENT =[0, 25, 50, 100, 200];
export const UTILITY_MULT = [0, 4, 10];

export const isOwnable = (t) => t.type === 'property' || t.type === 'station' || t.type === 'utility';

/**
 * Kartu. Efek:
 *  money(n)          +/- uang (negatif masuk Kas Negara)
 *  moveTo(i)         maju ke petak i (lewat GAJIAN = terima gaji)
 *  back(n)           mundur n langkah
 *  jail              langsung ke Ruang Sidang
 *  jailFree          simpan kartu Pemutihan
 *  repairs(h, okb)   bayar per rumah (lv1-3) & per Rumah OKB
 *  each(n)           terima n dari tiap pemain (negatif = bayar ke tiap pemain)
 *  nearestStation    maju ke stasiun terdekat, bayar sewa 2x
 */
export const CARDS = {
	musibah: [
		{ text: 'Banjir kiriman! Renovasi: bayar Rp 25 jt per rumah dan Rp 100 jt per Rumah OKB.', fx: { repairs: [25, 100] } },
		{ text: 'HP dicopet waktu desak-desakan di KRL. Bayar Rp 50 jt.', fx: { money: -50 } },
		{ text: 'Motor mogok nekat terobos genangan. Servis bengkel Rp 30 jt.', fx: { money: -30 } },
		{ text: 'Lupa ganjil-genap, kena tilang elektronik. Bayar Rp 50 jt.', fx: { money: -50 } },
		{ text: 'Kena razia, STNK mati! Langsung ke Ruang Sidang Tilang.', fx: { jail: true } },
		{ text: 'Kantor efisiensi, bonus tahunan ditiadakan. Bayar cicilan pakai tabungan Rp 100 jt.', fx: { money: -100 } },
		{ text: 'Harga cabai naik lagi. Bayar Rp 15 jt.', fx: { money: -15 } },
		{ text: 'Musim kondangan! Kasih amplop Rp 20 jt ke setiap pemain.', fx: { each: -20 } },
		{ text: 'Macet total di tol dalam kota. Mundur 3 petak.', fx: { back: 3 } },
		{ text: 'Barang dari online shop ternyata batu bata. Rugi Rp 40 jt.', fx: { money: -40 } },
		{ text: 'Kebablasan checkout pakai paylater. Bayar Rp 75 jt.', fx: { money: -75 } },
		{ text: 'Atap bocor tiap hujan. Bayar Rp 40 jt per rumah dan Rp 115 jt per Rumah OKB.', fx: { repairs: [40, 115] } },
		{ text: 'Anak masuk sekolah, ada uang gedung. Bayar Rp 150 jt.', fx: { money: -150 } },
		{ text: 'Kartu BPJS ketinggalan, bayar rumah sakit mandiri. Rp 100 jt.', fx: { money: -100 } },
		{ text: 'Tetangga pinjam uang "minggu depan dibalikin". Sudah 2 tahun. Rugi Rp 50 jt.', fx: { money: -50 } },
		{ text: 'Mudik lebaran kena macet 20 jam di jalur pantura. Mundur 2 petak.', fx: { back: 2 } }
	],
	takdir: [
		{ text: 'THR cair! Terima Rp 100 jt.', fx: { money: 100 } },
		{ text: 'Menang undian struk minimarket. Terima Rp 50 jt.', fx: { money: 50 } },
		{ text: 'Lolos CPNS! Syukuran dulu, terima Rp 150 jt.', fx: { money: 150 } },
		{ text: 'Kontenmu viral, banjir endorse. Terima Rp 100 jt.', fx: { money: 100 } },
		{ text: 'Cashback promo e-wallet. Terima Rp 20 jt.', fx: { money: 20 } },
		{ text: 'Program Pemutihan! Simpan kartu ini untuk bebas dari Ruang Sidang.', fx: { jailFree: true } },
		{ text: 'Pulang kampung jemput gaji. Maju ke GAJIAN.', fx: { moveTo: 0 } },
		{ text: 'Healing ke Bali. Maju ke Denpasar.', fx: { moveTo: 26 } },
		{ text: 'Coba naik Whoosh. Maju ke stasiun Whoosh.', fx: { moveTo: 35 } },
		{ text: 'Dipanggil meeting di SCBD. Maju ke SCBD.', fx: { moveTo: 39 } },
		{ text: 'Ulang tahun! Terima Rp 10 jt dari setiap pemain.', fx: { each: 10 } },
		{ text: 'Restitusi pajak cair. Terima Rp 75 jt.', fx: { money: 75 } },
		{ text: 'Bonus akhir tahun keluar. Terima Rp 100 jt.', fx: { money: 100 } },
		{ text: 'Nemu duit di saku jaket lama. Terima Rp 25 jt.', fx: { money: 25 } },
		{ text: 'Naik transportasi umum: maju ke stasiun terdekat. Kalau sudah ada pemilik, bayar sewa 2x.', fx: { nearestStation: true } },
		{ text: 'Namamu masuk daftar penerima bantuan. Maju ke Bansos Cair.', fx: { moveTo: 20 } }
	]
};

export const TOKENS = [
	{ id: 'motor', icon: '🛵', label: 'Motor' },
	{ id: 'bajaj', icon: '🛺', label: 'Bajaj' },
	{ id: 'angkot', icon: '🚐', label: 'Angkot' },
	{ id: 'ayam', icon: '🐓', label: 'Ayam Jago' },
	{ id: 'mie', icon: '🍜', label: 'Mie Ayam' },
	{ id: 'kok', icon: '🏸', label: 'Shuttlecock' }
];

export const PLAYER_COLORS = ['#D7263D', '#1F6FEB', '#2E9E5B', '#F08A24', '#8E44AD', '#0F8B8D'];

/**
 * Saham plesetan. Harga per lot dalam juta; vol = volatilitas per giliran.
 */
export const STOCKS = [
	{ sym: 'BACA', name: 'Bank Baca Aja', base: 100, vol: 0.03, note: 'Bank besar, kalem, jarang drama' },
	{ sym: 'BIBR', name: 'Bank Bibir Rakyat', base: 80, vol: 0.04, note: 'Bank kredit mikro, naik pelan-pelan' },
	{ sym: 'ASIK', name: 'Astra Asik Internasional', base: 120, vol: 0.055, note: 'Otomotif & alat berat, lumayan goyang' },
	{ sym: 'GATO', name: 'Gado Tekno Online', base: 40, vol: 0.1, note: 'Startup, siap-siap roller coaster' }
];
export const STOCK_HISTORY = 24;

/** nilai dalam juta; 1000 juta = 1 M */
export const formatAmt = (n) => {
	const a = Math.abs(n);
	return a >= 1000
		? `${(a / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`
		: `${a.toLocaleString('id-ID')} jt`;
};

// ---------- kalender pribadi ----------
// GAJIAN = tanggal 25. Satu putaran papan = satu bulan (25 -> 25 bulan berikutnya).
// Tiap petak menambah hari dengan bobot tetap yang tidak seragam, jadi tanggal bisa lompat 0-2 hari.
const CAL_W = Array.from({ length: TILES.length }, (_, i) => 0.35 + ((i * 7 + 3) % 5) * 0.4);
CAL_W[TILES.length - 1] = 1.6;
const CAL_CUM = [0];
for (const w of CAL_W) CAL_CUM.push(CAL_CUM[CAL_CUM.length - 1] + w);

/**
 * tanggal pemain yang berada di petak `pos` pada bulan ke-`laps` sejak game mulai
 * @param {{y:number,m:number}} base bulan GAJIAN pertama (m: 0-11)
 */
export function calendarDate(base, laps, pos) {
	const DAY = 86400000;
	const start = Date.UTC(base.y, base.m + laps, 25);
	const days = Math.round((Date.UTC(base.y, base.m + laps + 1, 25) - start) / DAY);
	const off = Math.round((days * CAL_CUM[pos]) / CAL_CUM[TILES.length]);
	return new Date(start + off * DAY);
}

/** kartu Pemutihan (bebas penjara) juga bisa dijual di Pasar; kuncinya "card:<idPenjual>" */
export const isCardKey = (k) => typeof k === 'string' && k.startsWith('card:');
export const JAIL_CARD = { name: 'Kartu Pemutihan', short: '🎫', type: 'card', group: null, price: 0 };
/** petak (angka) atau kartu (kunci "card:...") untuk satu listing Pasar */
export const listingTile = (k) => (isCardKey(k) ? JAIL_CARD : TILES[+k]);

export const formatRp = (n) => `${n < 0 ? '-' : ''}Rp ${formatAmt(n)}`;
