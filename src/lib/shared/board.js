// Data papan & kartu — dipakai server (aturan) dan client (tampilan).
// Satuan uang: juta rupiah (jt).

export const START_MONEY = 1500;
export const SALARY = 200;
export const JAIL_FINE = 50;
export const JAIL_INDEX = 13; // pojok kiri-bawah papan 14x8
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

/** Kebun Sawit hanya cocok di daerah penghasil sawit (Sumatra, Kalimantan, Sulawesi, Papua) */
export const SAWIT_CITIES = ['Medan', 'Balikpapan', 'Makassar', 'Raja Ampat'];
export const canSawit = (tile) => SAWIT_CITIES.includes(tile.name);
/** level tertinggi yang bisa dibangun di petak ini */
export const maxLevelOf = (tile) => (canSawit(tile) ? MAX_LEVEL : OKB_LEVEL);

/** biaya membangun ke level `level` (1..MAX_LEVEL) */
export const buildCost = (houseCost, level) => (level >= SAWIT_LEVEL ? houseCost * SAWIT_COST_MULT : houseCost);
/** total biaya yang sudah ditanam sampai `level` */
export const investedCost = (houseCost, level) => {
	let total = 0;
	for (let l = 1; l <= level; l++) total += buildCost(houseCost, l);
	return total;
};

/** semua petak properti dalam satu grup */
export const groupTilesOf = (group) => TILES.filter((t) => t.type === 'property' && t.group === group);

// ---------- merger / group ----------

/** semua anggota group pemain ini (termasuk dia); 1 elemen kalau solo */
export function teamMembersOf(state, playerId) {
	const p = state.players?.find((x) => x.id === playerId);
	if (!p) return [];
	if (!p.teamId) return [p];
	return state.players.filter((x) => x.teamId === p.teamId);
}
/** id se-group dengan playerId (termasuk playerId) — untuk kepemilikan bersama */
export const teamOwnerIdsOf = (state, playerId) => new Set(teamMembersOf(state, playerId).map((x) => x.id));
/** apakah dua id satu group */
export function sameTeamOf(state, a, b) {
	if (!a || !b || a === b) return false;
	const pa = state.players?.find((x) => x.id === a);
	const pb = state.players?.find((x) => x.id === b);
	return !!pa?.teamId && pa.teamId === pb?.teamId;
}

/** pemain (atau group-nya) menguasai semua kota di grup */
export const ownsGroup = (state, playerId, group) => {
	if (!group) return false;
	const ids = teamOwnerIdsOf(state, playerId);
	return groupTilesOf(group).every((t) => ids.has(state.tiles[t.i]?.owner));
};

/**
 * Bisa bangun/upgrade di petak ini sekarang? Cermin aturan server (engine.build).
 * @returns {{ level:number, next:number, name:string, icon:string, cost:number, afford:boolean }|null}
 */
export function canBuild(state, playerId, tileIdx) {
	if (!state || state.status !== 'playing') return null;
	const tile = TILES[tileIdx];
	const own = state.tiles?.[tileIdx];
	if (!tile || tile.type !== 'property' || !own) return null;
	// aset se-group milik bersama: anggota group boleh membangun di tanah partner
	if ((own.owner !== playerId && !sameTeamOf(state, own.owner, playerId)) || own.mortgaged) return null;
	if (!ownsGroup(state, playerId, tile.group)) return null;
	const gTiles = groupTilesOf(tile.group);
	if (gTiles.some((t) => state.tiles[t.i]?.mortgaged)) return null;
	const level = own.level ?? 0;
	if (level >= maxLevelOf(tile)) return null;
	// bangun merata: tak boleh lebih tinggi dari kota lain yang belum mentok
	const open = gTiles.filter((t) => (state.tiles[t.i]?.level ?? 0) < maxLevelOf(t));
	if (open.some((t) => (state.tiles[t.i]?.level ?? 0) < level)) return null;
	const next = level + 1;
	const cost = buildCost(GROUPS[tile.group].houseCost, next);
	const player = state.players?.find((p) => p.id === playerId);
	return { level, next, name: HOUSE_LEVELS[next].name, icon: HOUSE_LEVELS[next].icon, cost, afford: (player?.money ?? 0) >= cost };
}

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
	p('Semarang', 'pink', 140, [10, 50, 150, 450, 750]),
	{ type: 'utility', name: 'PLN', price: 150 },
	p('Solo', 'pink', 140, [10, 50, 150, 450, 750]),
	{ type: 'jail', name: 'Ruang Sidang Tilang', short: 'Sidang', desc: 'Cuma lewat, aman.' },
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
	p('BSD', 'hijau', 300, [26, 130, 390, 900, 1275]),
	p('PIK', 'hijau', 300, [26, 130, 390, 900, 1275]),
	{ type: 'takdir', name: 'Takdir' },
	{ type: 'gotojail', name: 'Kena Razia!', short: 'Razia', desc: 'Langsung ke Ruang Sidang Tilang' },
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

/**
 * Usaha: tiap pemain boleh pilih SATU saja. Pendapatannya masuk tiap lewat GAJIAN (payday).
 * Dibuat fair: makin besar modal, makin besar pendapatan per putaran, tapi makin lama balik modalnya.
 * Payback (putaran gajian) ≈ cost / income: reseller 0, warung ~3,3, pabrik ~4,4.
 * Jangka panjang modal besar paling untung; jangka pendek tanpa/kecil modal lebih aman.
 */
export const USAHA = [
	{ id: 'reseller', name: 'Reseller Online', emoji: '📦', modal: 'Modal receh', cost: 20, income: 25, musibahLoss: 60, desc: 'Modal receh 20 jt, langsung balik modal. Cuan tipis tapi aman, cocok buat yang irit.', musibah: 'Paketmu nyangkut di ekspedisi & banyak retur, reseller rugi' },
	{ id: 'warung', name: 'Warung Sembako', emoji: '🏪', modal: 'Modal kecil', cost: 250, income: 75, musibahLoss: 200, desc: 'Modal kecil, balik modal cepat (~3 putaran gajian). Pilihan paling seimbang.', musibah: 'Warungmu kebobolan maling semalam, stok ludes' },
	{ id: 'pabrik', name: 'Pabrik Kerupuk', emoji: '🏭', modal: 'Modal besar', cost: 800, income: 180, musibahLoss: 500, desc: 'Modal besar di awal, untung paling gede, tapi balik modalnya lama (~4–5 putaran).', musibah: 'Mesin pabrik kerupukmu rusak parah, produksi setop' }
];
export const usahaById = (id) => USAHA.find((u) => u.id === id) ?? null;
/** perkiraan berapa kali lewat GAJIAN untuk balik modal */
export const usahaPayback = (u) => (u.cost > 0 ? Math.round(u.cost / u.income) : 0);

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
 *  karhutla          SEMUA Kebun Sawit (milik siapa pun) hangus: turun ke Rumah OKB + denda sebesar biaya bangun sawit
 *  nearestStation    maju ke stasiun terdekat, bayar sewa 2x
 */
export const CARDS = {
	musibah: [
		{ text: 'Banjir kiriman! Renovasi: bayar Rp 25 jt per rumah dan Rp 100 jt per Rumah OKB.', req: 'house', fx: { repairs: [25, 100] } },
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
		{ text: 'Atap bocor tiap hujan. Bayar Rp 40 jt per rumah dan Rp 115 jt per Rumah OKB.', req: 'house', fx: { repairs: [40, 115] } },
		{ text: 'Anak masuk sekolah, ada uang gedung. Bayar Rp 150 jt.', fx: { money: -150 } },
		{ text: 'Kartu BPJS ketinggalan, bayar rumah sakit mandiri. Rp 100 jt.', fx: { money: -100 } },
		{ text: 'Tetangga pinjam uang "minggu depan dibalikin". Sudah 2 tahun. Rugi Rp 50 jt.', fx: { money: -50 } },
		{ text: '💼 Usahamu kena musibah operasional! Tanggung kerugiannya (makin besar usaha, makin besar ruginya).', req: 'usaha', fx: { usahaHit: true } },
		{ text: 'Mudik lebaran kena macet 20 jam di jalur pantura. Mundur 2 petak.', fx: { back: 2 } },
		{ text: '🔥 Karhutla! Kemarau panjang, lahan sawit terbakar. Semua Kebun Sawit hangus jadi Rumah OKB dan pemiliknya kena denda lingkungan sebesar biaya bangun sawit.', req: 'sawit', fx: { karhutla: true } },
		{ text: '🔥 Puntung rokok di lahan gambut, api menjalar ke kebun sawit! Semua Kebun Sawit hangus jadi Rumah OKB dan pemiliknya kena denda lingkungan sebesar biaya bangun sawit.', req: 'sawit', fx: { karhutla: true } }
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

/**
 * Berita "pemanis" yang keluar SEBELUM saham turun drastis (pump/rumor lalu dump).
 * Dipakai untuk ticker Netizen. Teks dipilih acak per saham sebagai pemantik,
 * dan juga disuapkan ke AI netizen supaya mereka ikut komentar.
 */
export const STOCK_NEWS = {
	BACA: [
		'BACA akan menambah lini usaha baru, investor euforia borong',
		'Rumor restrukturisasi utang jumbo di BACA bikin pasar waswas',
		'BACA dikabarkan terseret kredit macet korporasi raksasa',
		'OJK panggil direksi BACA soal rasio kredit bermasalah',
		'BACA umumkan buyback saham, analis malah ragu'
	],
	BIBR: [
		'BIBR ekspansi ke 100 kota, biaya operasional membengkak',
		'Gagal bayar nasabah mikro BIBR dilaporkan melonjak',
		'BIBR tunda bagi dividen tahun ini, investor kecewa',
		'BIBR gandeng startup paylater, risiko dipertanyakan'
	],
	ASIK: [
		'ASIK luncurkan mobil listrik, tapi penjualan dilaporkan loyo',
		'Permintaan alat berat anjlok, proyeksi laba ASIK dipangkas',
		'ASIK kena recall massal, reputasi dipertaruhkan',
		'Harga komoditas jatuh, order tambang ASIK menyusut'
	],
	GATO: [
		'GATO bakar uang lagi demi promo, kerugian membengkak',
		'Investor besar GATO dikabarkan mau cabut',
		'GATO PHK ribuan karyawan, dalih "efisiensi"',
		'Valuasi GATO dipertanyakan, bubble startup tekno?',
		'Fitur baru GATO sepi peminat, pertumbuhan melambat'
	]
};
const STOCK_NEWS_GENERIK = (sym) => [
	`Sentimen pasar memburuk, ${sym} ikut tertekan`,
	`Asing lepas kepemilikan di ${sym}, harga rawan koreksi`,
	`Analis turunkan rekomendasi ${sym} jadi "jual"`
];
export function pickStockNews(sym, rng = Math.random) {
	const pool = STOCK_NEWS[sym] ?? STOCK_NEWS_GENERIK(sym);
	return pool[Math.floor(rng() * pool.length)];
}

/** candle OHLC saham; game lama yang belum punya `candles` diturunkan dari riwayat harga penutupan */
export function candlesOf(st) {
	if (st?.candles?.length) return st.candles;
	const h = st?.history ?? [];
	return h.slice(1).map((c, i) => ({ o: h[i], h: Math.max(h[i], c), l: Math.min(h[i], c), c }));
}

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
export const isUsahaKey = (k) => typeof k === 'string' && k.startsWith('usaha:');
export const usahaKey = (id) => `usaha:${id}`;
export const usahaSellerId = (k) => (isUsahaKey(k) ? k.slice('usaha:'.length) : null);
export const JAIL_CARD = { name: 'Kartu Pemutihan', short: '🎫', type: 'card', group: null, price: 0 };
export const USAHA_CARD = { name: 'Usaha', short: '💼', type: 'usaha', group: null, price: 0 };
/** petak (angka) atau kartu (kunci "card:...") untuk satu listing Pasar */
export const listingTile = (k) => (isCardKey(k) ? JAIL_CARD : isUsahaKey(k) ? USAHA_CARD : TILES[+k]);

/** simbol gulungan judol slot */
export const SLOT_SYMBOLS = ['7️⃣', '💎', '🍒', '🍋', '🔔', '💀'];

/** kekayaan bersih (uang + aset + saham) segini = langsung menang (Rp 10 M) */
export const WIN_NETWORTH = 10000;

export const formatRp = (n) => `${n < 0 ? '-' : ''}Rp ${formatAmt(n)}`;

/** Iklan properti (fitur "Pasang Iklan"): durasi tayang & biaya force-skip. */
export const AD_SECONDS = 20;
export const AD_SKIP_COST = 25; // Rp 25 jt untuk skip paksa, masuk Kas Negara
/** biaya pasang iklan = 25% harga properti */
export const adCost = (tile) => Math.round((tile?.price ?? 0) * 0.25);
/** teks iklan statis per properti (bervariasi berdasarkan indeks petak) */
export function adCopy(tile) {
	const area = GROUPS[tile.group]?.label ?? 'kota';
	const taglines = [
		'fasilitas lengkap, akses tol & transportasi, cocok buat investasi!',
		'lingkungan asri, dekat mall & kuliner, harga dijamin naik terus!',
		`hunian premium kawasan ${area}, keamanan 24 jam, bebas banjir!`,
		'lokasi strategis, ROI tinggi — buruan sebelum kehabisan unit!',
		`primadona ${area}, dekat sekolah & rumah sakit, nilai aset melambung!`
	];
	return `Kunjungi ${tile.name} — ${taglines[(tile.i ?? 0) % taglines.length]}`;
}

/** nilai saham yang dipegang pemain pada harga pasar sekarang */
export function stockValue(state, p) {
	let total = 0;
	for (const [sym, h] of Object.entries(p.stocks ?? {})) total += h.qty * (state.stocks?.[sym]?.price ?? 0);
	return total;
}

/**
 * Perkiraan total aset: uang + saham + properti (harga beli, separuh bila digadai) + modal bangunan.
 * Team-aware: untuk pemain ber-group, kembalikan kekayaan group (kas bersama dihitung sekali +
 * saham, aset & usaha kedua anggota) — nilai sama ditampilkan di kedua kartu.
 */
export function netWorth(state, p) {
	const members = teamMembersOf(state, p.id);
	const ids = new Set(members.map((m) => m.id));
	// kas bersama di-mirror sama di tiap anggota, jadi dihitung sekali
	let total = members[0]?.money ?? p.money;
	for (const m of members) total += stockValue(state, m);
	for (const [i, t] of Object.entries(state.tiles)) {
		if (!ids.has(t.owner)) continue;
		const tile = TILES[+i];
		total += t.mortgaged ? tile.price / 2 : tile.price;
		if (tile.type === 'property') total += investedCost(GROUPS[tile.group].houseCost, t.level);
	}
	for (const m of members) {
		const u = usahaById(m.usaha);
		if (u) total += u.cost; // usaha dihitung aset senilai modal awal
	}
	return total;
}

/**
 * id pemain "raja": kekayaan bersih tertinggi (tunggal, tidak seri) saat game berjalan.
 * Satu entitas per group — anggota se-group berbagi kekayaan jadi tidak saling seri;
 * kalau group yang terkaya, kembalikan wakilnya (lihat isKing untuk mahkota di kedua anggota).
 */
export function richestId(state) {
	if (state.status !== 'playing') return null;
	const seen = new Set();
	const ranked = [];
	for (const p of state.players) {
		if (p.bankrupt) continue;
		const key = p.teamId ?? p.id;
		if (seen.has(key)) continue; // hitung group sekali
		seen.add(key);
		ranked.push({ id: p.id, w: netWorth(state, p) });
	}
	ranked.sort((a, b) => b.w - a.w);
	return ranked.length > 1 && ranked[0].w > ranked[1].w ? ranked[0].id : null;
}

/** apakah pemain ini "raja" — termasuk anggota se-group dari si terkaya (mahkota di keduanya) */
export function isKing(state, playerId) {
	const kid = richestId(state);
	return !!kid && (kid === playerId || sameTeamOf(state, kid, playerId));
}

/**
 * Rekomendasi to-do rule-based (tanpa AI) untuk pemain: fokus pada grup warna yang sudah
 * dikuasai minimal separuh (1/2) atau dua-pertiga (2/3). Kosong kalau belum ada grup sejauh itu.
 * Item `done: true` dipakai untuk mencoret rekomendasi yang sudah terpenuhi.
 * @returns {{ key:string, text:string, done:boolean }[]}
 */
export function playerTodos(state, playerId) {
	if (!playerId || !state?.tiles) return [];
	const todos = [];
	for (const [gid, g] of Object.entries(GROUPS)) {
		const tiles = TILES.filter((t) => t.group === gid);
		const size = tiles.length;
		const owned = tiles.filter((t) => state.tiles[t.i]?.owner === playerId);
		if (owned.length < Math.ceil(size / 2)) continue; // belum 1/2 atau 2/3 -> lewati
		if (owned.length < size) {
			const missing = tiles.filter((t) => state.tiles[t.i]?.owner !== playerId).map((t) => t.name);
			todos.push({ key: `grup-${gid}`, done: false, text: `Lengkapi ${g.label}: beli ${missing.join(', ')}` });
		} else {
			todos.push({ key: `grup-${gid}`, done: true, text: `Kuasai grup ${g.label}` });
			const mortgaged = owned.some((t) => state.tiles[t.i]?.mortgaged);
			if (!mortgaged) {
				const allBuilt = owned.every((t) => (state.tiles[t.i]?.level ?? 0) > 0);
				todos.push({ key: `bangun-${gid}`, done: allBuilt, text: `Bangun rumah di ${g.label}` });
			}
		}
	}
	return todos;
}

/**
 * Perkiraan kalau pemain menyerah. Semua aset dijual otomatis di HARGA ASLI (bukan obral):
 * properti di harga beli (digadai: separuh, karena separuhnya sudah dipinjam), bangunan/rumah di
 * biaya bangun penuh, saham di harga sekarang. Hasilnya dipakai menutup tagihan:
 *   sisa > 0  -> lanjut main hanya dengan uang sisa; sisa <= 0 -> bangkrut.
 * Tanpa tagihan/utang sama sekali, menyerah = keluar dari game (bangkrut).
 */
export function surrenderPlan(state, p) {
	// team-aware: aset & saham dihitung untuk seluruh anggota group; kas bersama dihitung sekali
	const members = teamMembersOf(state, p.id);
	const ids = new Set(members.map((m) => m.id));
	let properties = 0;
	let buildings = 0;
	for (const [i, t] of Object.entries(state.tiles)) {
		if (!ids.has(t.owner)) continue;
		const tile = TILES[+i];
		properties += t.mortgaged ? tile.price / 2 : tile.price;
		// rumah/bangunan dihitung penuh di biaya bangunnya (harga asli), bukan separuh harga jual
		if (tile.type === 'property') buildings += investedCost(GROUPS[tile.group].houseCost, t.level);
	}
	let stocks = 0;
	for (const m of members) stocks += stockValue(state, m);
	const cash = members[0]?.money ?? p.money; // kas bersama (di-mirror sama)
	// tagihan sewa yang sedang menunggu (hanya kalau penagihnya masih ada & bukan se-group)
	const r = state.pendingRent;
	const own = r && state.tiles[r.tile];
	const creditor =
		state.phase === 'rent' && ids.has(state.players[state.turn]?.id) && own && !own.mortgaged
			? state.players.find((x) => x.id === own.owner && !x.bankrupt && !ids.has(x.id))
			: null;
	const rent = creditor ? r.amount : 0;
	const hasDebt = rent > 0 || cash < 0;
	const left = cash + properties + buildings + stocks - rent;
	return {
		money: cash,
		properties,
		buildings,
		stocks,
		rent,
		creditorId: creditor?.id ?? null,
		left,
		outcome: !hasDebt ? 'keluar' : left > 0 ? 'lanjut' : 'bangkrut'
	};
}
