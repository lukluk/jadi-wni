// Foto latar tiap kota dari Wikipedia/Wikimedia Commons.
// - Pakai API pageimages (default pilicense=free → hanya gambar berlisensi bebas).
// - Kredit (pembuat + lisensi) diambil dari Commons extmetadata dan ditampilkan di UI.
// - Hasil di-cache di SQLite, diperbarui tiap 30 hari. Gagal fetch = papan tetap jalan pakai warna grup.
// - Override manual: server/city-images.overrides.json  { "SCBD": { "url": "...", "credit": "...", "license": "...", "page": "..." } }
import { readFileSync, existsSync } from 'node:fs';
import { TILES } from '../src/lib/shared/board.js';
import { getDb } from './db.js';

const UA = 'JadiWNI/0.1 (game edukasi; https://github.com/)';
const REFRESH_MS = 30 * 864e5;
const THUMB = 640;

/** nama petak → judul artikel Wikipedia bahasa Inggris */
export const WIKI_TITLES = {
	Cikarang: 'Cikarang',
	Bekasi: 'Bekasi',
	Depok: 'Depok',
	Bogor: 'Bogor',
	Tangerang: 'Tangerang',
	Semarang: 'Semarang',
	Solo: 'Surakarta',
	Yogyakarta: 'Yogyakarta',
	Malang: 'Malang',
	Surabaya: 'Surabaya',
	Bandung: 'Bandung',
	Medan: 'Medan',
	Makassar: 'Makassar',
	Balikpapan: 'Balikpapan',
	Denpasar: 'Denpasar',
	'Labuan Bajo': 'Labuan Bajo',
	'Raja Ampat': 'Raja Ampat Islands',
	BSD: 'BSD City',
	PIK: 'Pantai Indah Kapuk',
	Kemang: 'Kemang, Jakarta',
	Menteng: 'Menteng',
	SCBD: 'Sudirman Central Business District'
};

/** foto manual dari Commons untuk kota yang artikel Wikipedia-nya tidak punya foto bebas */
export const COMMONS_FILES = {
	Kemang: 'File:Avenue of the Stars, Lippo Mall Kemang.jpg'
};

function ensureTable() {
	getDb().exec(`CREATE TABLE IF NOT EXISTS city_images (
		name TEXT PRIMARY KEY,
		url TEXT,
		credit TEXT,
		license TEXT,
		page TEXT,
		fetched_at INTEGER NOT NULL
	)`);
}

const stripHtml = (s = '') =>
	s
		.replace(/<[^>]*>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);

/** ikuti normalized + redirects sampai judul akhir */
function resolver(query) {
	const map = new Map();
	for (const n of query.normalized ?? []) map.set(n.from, n.to);
	for (const r of query.redirects ?? []) map.set(r.from, r.to);
	return (title) => {
		let t = title;
		for (let i = 0; i < 5 && map.has(t); i++) t = map.get(t);
		return t;
	};
}

/**
 * Ambil foto untuk semua kota. fetchImpl bisa di-mock untuk tes.
 * @returns {Promise<Record<string, {url:string, credit:string, license:string, page:string}>>}
 */
export async function fetchCityImages(fetchImpl = fetch) {
	const names = Object.keys(WIKI_TITLES);
	const titles = names.map((n) => WIKI_TITLES[n]);
	const get = async (base, params) => {
		const url = `${base}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
		const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
		if (!res.ok) throw new Error(`${base} HTTP ${res.status}`);
		return res.json();
	};

	// 1) gambar utama artikel (hanya lisensi bebas)
	const pi = await get('https://en.wikipedia.org/w/api.php', {
		action: 'query',
		prop: 'pageimages',
		piprop: 'thumbnail|name',
		pithumbsize: String(THUMB),
		redirects: '1',
		titles: titles.join('|')
	});
	const resolve = resolver(pi.query);
	const pages = new Map((pi.query.pages ?? []).map((p) => [p.title, p]));

	/** @type {Record<string, any>} */
	const found = {};
	for (const name of names) {
		const page = pages.get(resolve(WIKI_TITLES[name]));
		const src = page?.thumbnail?.source;
		if (!src || !page.pageimage || !src.includes('/wikipedia/commons/')) continue;
		found[name] = {
			url: src,
			file: `File:${page.pageimage}`,
			page: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`
		};
	}

	// berkas Commons manual untuk kota yang belum dapat foto
	for (const [name, file] of Object.entries(COMMONS_FILES))
		if (!found[name]) found[name] = { url: null, file, page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(file.replace(/ /g, '_'))}` };

	// 2) kredit & lisensi dari Commons
	const files = Object.values(found).map((f) => f.file);
	if (files.length) {
		const ii = await get('https://commons.wikimedia.org/w/api.php', {
			action: 'query',
			prop: 'imageinfo',
			iiprop: 'extmetadata|url',
			iiurlwidth: String(THUMB),
			iiextmetadatafilter: 'Artist|LicenseShortName',
			titles: files.join('|')
		});
		const res2 = resolver(ii.query);
		const meta = new Map((ii.query.pages ?? []).map((p) => [p.title, p.imageinfo?.[0]]));
		for (const f of Object.values(found)) {
			const info = meta.get(res2(f.file));
			const em = info?.extmetadata ?? {};
			f.credit = stripHtml(em.Artist?.value) || 'Wikimedia Commons';
			f.license = stripHtml(em.LicenseShortName?.value) || '';
			f.page = info?.descriptionurl ?? f.page;
			f.url ??= info?.thumburl ?? null;
			delete f.file;
		}
		for (const name of Object.keys(found)) if (!found[name].url) delete found[name];
	}
	return found;
}

function loadOverrides() {
	const path = new URL('./city-images.overrides.json', import.meta.url);
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		console.warn('city-images.overrides.json tidak valid:', e.message);
		return {};
	}
}

/** map nama kota → foto (cache + override) */
export function getCityImages() {
	ensureTable();
	const rows = getDb().prepare('SELECT name, url, credit, license, page FROM city_images WHERE url IS NOT NULL').all();
	const out = Object.fromEntries(rows.map((r) => [r.name, { url: r.url, credit: r.credit, license: r.license, page: r.page }]));
	return { ...out, ...loadOverrides() };
}

let refreshing = false;

/** dipanggil saat server start; tidak memblokir */
export async function refreshCityImages({ force = false, fetchImpl = fetch } = {}) {
	if (refreshing) return;
	ensureTable();
	const db = getDb();
	const oldest = db.prepare('SELECT MIN(fetched_at) AS t, COUNT(*) AS n FROM city_images').get();
	const cityCount = TILES.filter((t) => t.type === 'property').length;
	const missingManual = Object.keys(COMMONS_FILES).some(
		(n) => !db.prepare('SELECT 1 FROM city_images WHERE name = ? AND url IS NOT NULL').get(n)
	);
	if (!force && !missingManual && oldest.n >= cityCount && Date.now() - oldest.t < REFRESH_MS) return;
	refreshing = true;
	try {
		const found = await fetchCityImages(fetchImpl);
		const upsert = db.prepare(
			`INSERT INTO city_images (name, url, credit, license, page, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(name) DO UPDATE SET url=excluded.url, credit=excluded.credit, license=excluded.license, page=excluded.page, fetched_at=excluded.fetched_at`
		);
		const now = Date.now();
		for (const name of Object.keys(WIKI_TITLES)) {
			const f = found[name];
			upsert.run(name, f?.url ?? null, f?.credit ?? null, f?.license ?? null, f?.page ?? null, now);
		}
		console.log(`[jadi-wni] foto kota: ${Object.keys(found).length}/${Object.keys(WIKI_TITLES).length} didapat dari Wikimedia.`);
	} catch (e) {
		console.warn('[jadi-wni] gagal ambil foto kota (papan tetap jalan tanpa foto):', e.message);
	} finally {
		refreshing = false;
	}
}
