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
	{ name: 'Rumah OKB', short: 'OKB', icon: '🏰' }
];
export const MAX_LEVEL = HOUSE_LEVELS.length - 1;

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
 * @typedef {{ i:number, type:'start'|'property'|'station'|'utility'|'tax'|'musibah'|'takdir'|'jail'|'arisan'|'gotojail',
 *   name:string, short?:string, group?:string, price?:number, rent?:number[], amount?:number, desc?:string }} Tile
 */

/** rent: [tanah, Subsidi, Tipe45, Cluster, OKB] */
const p = (name, group, price, rent, short) => ({ type: 'property', name, group, price, rent, short });

/** @type {Tile[]} */
export const TILES = [
	{ type: 'start', name: 'GAJIAN', desc: `Lewat sini terima gaji Rp ${SALARY} jt` },
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
	{ type: 'arisan', name: 'Menang Arisan', short: 'Arisan', desc: 'Ambil semua uang di Kas Arisan' },
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

export const STATION_RENT = [0, 25, 50, 100, 200];
export const UTILITY_MULT = [0, 4, 10];

export const isOwnable = (t) => t.type === 'property' || t.type === 'station' || t.type === 'utility';

/**
 * Kartu. Efek:
 *  money(n)          +/- uang (negatif masuk Kas Arisan)
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
		{ text: 'Ditunjuk jadi bendahara arisan. Maju ke Menang Arisan.', fx: { moveTo: 20 } }
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

export const formatRp = (n) => `${n < 0 ? '-' : ''}Rp ${Math.abs(n).toLocaleString('id-ID')} jt`;
