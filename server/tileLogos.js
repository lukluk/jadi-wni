// Logo petak non-kota (stasiun & utilitas) dari Wikimedia Commons.
// - Daftar berkas Commons ditetapkan manual (logo teks berlisensi public domain di Commons).
// - Lisensi & kredit diambil dari extmetadata dan ditampilkan lewat atribut title di UI.
// - Cache di SQLite, diperbarui tiap 30 hari. Gagal fetch = petak tetap pakai ikon emoji.
import { getDb } from './db.js';

const UA = 'JadiWNI/0.1 (game edukasi; https://github.com/)';
const REFRESH_MS = 30 * 864e5;
const THUMB = 200;

/** nama petak → berkas Commons */
export const LOGO_FILES = {
	'KRL Commuter': 'File:Logo KAI Commuter.svg',
	Transjakarta: 'File:TransJakarta Logo.svg',
	'MRT Jakarta': 'File:MRT Jakarta logo.svg',
	Whoosh: 'File:WHOOSH Logo.svg',
	PLN: 'File:Logo PLN.svg',
	PDAM: 'File:PAM JAYA Logo.svg',
	'Bansos Cair': 'File:Logo of the Ministry of Social Affairs of the Republic of Indonesia.svg'
};

function ensureTable() {
	getDb().exec(`CREATE TABLE IF NOT EXISTS tile_logos (
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

/**
 * @returns {Promise<Record<string, {url:string, credit:string, license:string, page:string}>>}
 */
export async function fetchTileLogos(fetchImpl = fetch) {
	const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
		action: 'query',
		prop: 'imageinfo',
		iiprop: 'url|extmetadata',
		iiurlwidth: String(THUMB),
		iiextmetadatafilter: 'Artist|LicenseShortName',
		format: 'json',
		formatversion: '2',
		origin: '*',
		titles: Object.values(LOGO_FILES).join('|')
	})}`;
	const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
	if (!res.ok) throw new Error(`commons HTTP ${res.status}`);
	const data = await res.json();
	const map = new Map();
	for (const n of data.query?.normalized ?? []) map.set(n.from, n.to);
	const byTitle = new Map((data.query?.pages ?? []).map((p) => [p.title, p.imageinfo?.[0]]));
	/** @type {Record<string, any>} */
	const out = {};
	for (const [name, file] of Object.entries(LOGO_FILES)) {
		const info = byTitle.get(map.get(file) ?? file);
		const src = info?.thumburl ?? info?.url;
		if (!src) continue;
		const em = info.extmetadata ?? {};
		out[name] = {
			url: src,
			credit: stripHtml(em.Artist?.value) || 'Wikimedia Commons',
			license: stripHtml(em.LicenseShortName?.value) || '',
			page: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(file.replace(/ /g, '_'))}`
		};
	}
	return out;
}

export function getTileLogos() {
	ensureTable();
	const rows = getDb().prepare('SELECT name, url, credit, license, page FROM tile_logos WHERE url IS NOT NULL').all();
	return Object.fromEntries(rows.map((r) => [r.name, { url: r.url, credit: r.credit, license: r.license, page: r.page }]));
}

let refreshing = false;

/** dipanggil saat server start; tidak memblokir */
export async function refreshTileLogos({ force = false, fetchImpl = fetch } = {}) {
	if (refreshing) return;
	ensureTable();
	const db = getDb();
	const oldest = db.prepare('SELECT MIN(fetched_at) AS t, COUNT(*) AS n FROM tile_logos WHERE url IS NOT NULL').get();
	if (!force && oldest.n >= Object.keys(LOGO_FILES).length && Date.now() - oldest.t < REFRESH_MS) return;
	refreshing = true;
	try {
		const found = await fetchTileLogos(fetchImpl);
		const upsert = db.prepare(
			`INSERT INTO tile_logos (name, url, credit, license, page, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(name) DO UPDATE SET url=excluded.url, credit=excluded.credit, license=excluded.license, page=excluded.page, fetched_at=excluded.fetched_at`
		);
		const now = Date.now();
		for (const name of Object.keys(LOGO_FILES)) {
			const f = found[name];
			upsert.run(name, f?.url ?? null, f?.credit ?? null, f?.license ?? null, f?.page ?? null, now);
		}
		console.log(`[jadi-wni] logo petak: ${Object.keys(found).length}/${Object.keys(LOGO_FILES).length} didapat dari Wikimedia Commons.`);
	} catch (e) {
		console.warn('[jadi-wni] gagal ambil logo petak (petak tetap pakai ikon):', e.message);
	} finally {
		refreshing = false;
	}
}
