import { TILES, OKB_LEVEL, formatRp } from '../src/lib/shared/board.js';
import { netWorth } from './game/engine.js';
import './config.js';

/** Netizen AI: tiap 5 menit baca kondisi semua pemain lalu "netizen" mengomentari + memberi saran. */
export const NETIZEN_INTERVAL_MS = 5 * 60_000;
const MODEL = () => process.env.AI_MODEL || 'gpt-4o-mini';
const BASE = () => (process.env.AI_BASE_URL || 'https://ai.sumopod.com').replace(/\/+$/, '').replace(/\/v1$/, '');
const MAX_POSTS = 8;

export const netizenEnabled = () => !!process.env.AI_API_KEY;

const okbCount = (state, id) =>
	Object.entries(state.tiles).filter(([i, t]) => t.owner === id && TILES[+i].type === 'property' && t.level >= OKB_LEVEL).length;

/** keadaan yang dibandingkan antar siklus untuk menemukan "sorotan" */
function standing(state) {
	const ranked = state.players.filter((p) => !p.bankrupt).map((p) => ({ p, w: netWorth(state, p) })).sort((a, b) => b.w - a.w);
	const top = ranked.length > 1 && ranked[0].w > ranked[1].w ? ranked[0] : null;
	return { leader: top?.p.id ?? null, leaderName: top?.p.name, leaderWorth: top?.w, okb: Object.fromEntries(state.players.map((p) => [p.id, okbCount(state, p.id)])) };
}

/** peristiwa layak ucapan selamat sejak siklus lalu: jadi orang terkaya (top 1) & punya Rumah OKB baru */
function highlights(state, cur, prev) {
	const out = [];
	if (cur.leader && cur.leader !== prev?.leader)
		out.push(`${cur.leaderName} BARU SAJA jadi pemain TERKAYA nomor 1 (kekayaan bersih ${formatRp(cur.leaderWorth)}).`);
	for (const p of state.players) {
		const n = cur.okb[p.id] ?? 0;
		if (!p.bankrupt && n > (prev?.okb[p.id] ?? 0)) out.push(`${p.name} baru punya Rumah OKB (sekarang ${n}).`);
	}
	return out;
}

/** ringkasan kondisi game untuk prompt */
function snapshot(state, sorotan = []) {
	const players = state.players.map((p) => {
		const owned = Object.entries(state.tiles).filter(([, t]) => t.owner === p.id);
		return {
			nama: p.name,
			uang: formatRp(p.money),
			kekayaan_bersih: formatRp(netWorth(state, p)),
			posisi: TILES[p.pos]?.name,
			di_penjara: p.inJail,
			jumlah_properti: owned.length,
			digadai: owned.filter(([, t]) => t.mortgaged).length,
			saham: Object.fromEntries(Object.entries(p.stocks ?? {}).map(([k, v]) => [k, v.qty])),
			bangkrut: p.bankrupt
		};
	});
	return {
		giliran_ke: state.turnCount,
		pemain_giliran_sekarang: state.players[state.turn]?.name,
		kas_negara: formatRp(state.kasNegara ?? 0),
		sorotan_baru: sorotan,
		pemain: players,
		kejadian_terbaru: state.log.slice(-15).map((l) => l.msg)
	};
}

const SYSTEM = `Kamu adalah kumpulan netizen Indonesia di X (Twitter) yang menonton permainan Monopoli bertema "Jadi WNI".
Tugasmu: berdasarkan kondisi terkini para pemain, tulis ${MAX_POSTS} cuitan netizen yang berbeda-beda.
Gaya: bahasa gaul Indonesia, julid tapi lucu, boleh sarkas, ada yang nyinyir, ada yang memuji, ada yang kasih saran strategi konkret (beli properti apa, jual saham, jangan judol, bayar utang, dll) berdasarkan data.
Setiap cuitan menyebut nama pemain yang sebenarnya ada di data. Jangan mengarang angka. Tanpa SARA, tanpa ujaran kebencian, tanpa kata kasar berat.
Kalau ada "sorotan_baru" di data, WAJIB buat cuitan ucapan selamat (kind "selamat") untuk tiap sorotan, riuh dan heboh ala netizen.
Untuk sorotan pemain baru jadi TERKAYA nomor 1, sertakan juga satu berita bergaya media (kind "berita", handle "@Tempo_WNI", gaya headline), contoh: "Tempo: Budi masuk jajaran 9 naga" lalu satu kalimat latar tentang hartanya.
Sisa cuitan tetap komentar/saran biasa. Total tetap ${MAX_POSTS} cuitan.
Balas HANYA JSON array tanpa teks lain: [{"handle":"@akun_netizen","text":"isi cuitan maks 200 karakter","kind":"komentar"|"saran"|"selamat"|"berita"}]`;

/** @returns {Promise<{handle:string,text:string,kind:string}[]>} */
async function askAI(state, sorotan) {
	const res = await fetch(`${BASE()}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY ?? ''}` },
		body: JSON.stringify({
			model: MODEL(),
			max_tokens: 1500,
			messages: [
				{ role: 'system', content: SYSTEM },
				{ role: 'user', content: `Kondisi game saat ini:\n${JSON.stringify(snapshot(state, sorotan), null, 1)}` }
			]
		}),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = await res.json();
	const raw = data.choices?.[0]?.message?.content ?? '';
	const json = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1);
	const arr = JSON.parse(json);
	return arr
		.filter((x) => x && typeof x.text === 'string')
		.slice(0, MAX_POSTS)
		.map((x) => ({
			handle: x.kind === 'berita' ? '@Tempo_WNI' : String(x.handle ?? '@netizen').slice(0, 24),
			text: x.text.slice(0, 280),
			kind: ['saran', 'selamat', 'berita'].includes(x.kind) ? x.kind : 'komentar'
		}));
}

/** @type {Map<string, {posts:any[], at:number, nextAt:number, turn:number, busy:boolean, prev:any}>} */
const feeds = new Map();

export function feedOf(code) {
	const f = feeds.get(code);
	return f ? { posts: f.posts, at: f.at, nextAt: f.nextAt } : null;
}

/**
 * Dipanggil periodik (tiap detik-an). Mulai siklus 5 menit sejak game jalan; tiap siklus selesai
 * kirim feed baru lewat emit(code, feed). Siklus dilewati kalau game tidak maju sejak siklus lalu.
 */
export function tickNetizen(rooms, emit, now = Date.now()) {
	if (!netizenEnabled()) return;
	for (const [code, state] of rooms) {
		if (state.status !== 'playing') {
			feeds.delete(code);
			continue;
		}
		let f = feeds.get(code);
		if (!f) {
			f = { posts: [], at: 0, nextAt: now + NETIZEN_INTERVAL_MS, turn: -1, busy: false, prev: null };
			feeds.set(code, f);
			emit(code, feedOf(code));
		}
		if (f.busy || now < f.nextAt) continue;
		if (state.turnCount === f.turn) {
			f.nextAt = now + NETIZEN_INTERVAL_MS;
			emit(code, feedOf(code));
			continue;
		}
		f.busy = true;
		const cur = standing(state);
		askAI(state, highlights(state, cur, f.prev))
			.then((posts) => {
				if (posts.length) Object.assign(f, { posts, at: Date.now(), turn: state.turnCount, prev: cur });
			})
			.catch((e) => console.error('[netizen]', e.message))
			.finally(() => {
				f.busy = false;
				f.nextAt = Date.now() + NETIZEN_INTERVAL_MS;
				emit(code, feedOf(code));
			});
	}
}
