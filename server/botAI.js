// Bot AI: pemain komputer digerakkan LLM untuk keputusan "lunak" — main saham, nego beli properti,
// terima/tolak tawaran, jual properti kalau perlu, dan ngobrol ke pemain asli.
// Mekanik giliran wajib (lempar dadu, beli saat mendarat, bayar sewa) tetap ditangani bot.js (rule-based),
// jadi game tetap jalan walau AI mati/lambat. Semua di sini butuh AI_API_KEY; tanpa itu, no-op.
import { TILES, GROUPS, STOCKS } from '../src/lib/shared/board.js';
import { applyAction, netWorth, GameError } from './game/engine.js';
import './config.js';

const MODEL = () => process.env.AI_MODEL || 'gpt-4o-mini';
const BASE = () => (process.env.AI_BASE_URL || 'https://ai.sumopod.com').replace(/\/+$/, '').replace(/\/v1$/, '');

export const botAIEnabled = () => !!process.env.AI_API_KEY;

/** jeda minimum antar konsultasi AI per bot, dan antar chat per bot */
const THINK_INTERVAL_MS = Number(process.env.BOT_AI_INTERVAL_MS) || 18_000;
const CHAT_MIN_GAP_MS = 35_000;
const MAX_ACTIONS = 4;

/** tipe aksi yang boleh dikeluarkan AI (sisanya diabaikan) */
const ALLOWED = new Set(['stockBuy', 'stockSell', 'mkOffer', 'mkAccept', 'mkReject', 'mkList', 'mkUnlist', 'mortgage', 'unmortgage', 'sell']);

const groupLabel = (g) => GROUPS[g]?.label ?? g;

/** properti milik satu pemain, ringkas */
function propsOf(state, id) {
	return Object.entries(state.tiles)
		.filter(([, t]) => t.owner === id)
		.map(([i, t]) => {
			const tile = TILES[+i];
			return { i: +i, nama: tile.name, grup: tile.group ? groupLabel(tile.group) : tile.type, level: t.level ?? 0, digadai: !!t.mortgaged };
		});
}

/** daftar pasar + tawaran yang menuju bot ini */
function marketView(state, botId) {
	const listings = [];
	const tawaranKeAku = [];
	for (const [key, l] of Object.entries(state.market ?? {})) {
		const idx = Number(key);
		if (!Number.isInteger(idx) || !TILES[idx]) continue; // fokus properti (lewati kartu/usaha)
		const seller = state.players.find((p) => p.id === l.seller);
		const offers = Object.entries(l.offers ?? {}).map(([bid, price]) => ({
			penawar_id: bid,
			penawar: state.players.find((p) => p.id === bid)?.name ?? '?',
			harga: price
		}));
		listings.push({ tile: idx, nama: TILES[idx].name, penjual: seller?.name ?? '?', penjual_id: l.seller, harga_jual: l.price, tawaran: offers });
		if (l.seller === botId) for (const o of offers) tawaranKeAku.push({ tile: idx, nama: TILES[idx].name, penawar_id: o.penawar_id, penawar: o.penawar, harga: o.harga });
	}
	return { listings, tawaranKeAku };
}

function snapshot(state, bot, recentChat) {
	const me = {
		id: bot.id,
		nama: bot.name,
		uang_jt: bot.money,
		kekayaan_bersih_jt: netWorth(state, bot),
		properti: propsOf(state, bot.id),
		saham: Object.fromEntries(Object.entries(bot.stocks ?? {}).map(([k, v]) => [k, { lot: v.qty, modal_jt: v.cost }])),
		usaha: bot.usaha ?? null,
		di_penjara: !!bot.inJail
	};
	const lawan = state.players
		.filter((p) => !p.bankrupt && p.id !== bot.id)
		.map((p) => ({ id: p.id, nama: p.name, uang_jt: p.money, properti: propsOf(state, p.id) }));
	const { listings, tawaranKeAku } = marketView(state, bot.id);
	return {
		giliran_ke: state.turnCount,
		aku: me,
		lawan,
		pasar: listings,
		tawaran_masuk_ke_aku: tawaranKeAku,
		saham: Object.fromEntries(STOCKS.map((s) => [s.sym, { harga_jt: state.stocks?.[s.sym]?.price ?? s.base, harga_dasar_jt: s.base }])),
		chat_terakhir: recentChat.slice(-6).map((c) => ({ nama: c.name, teks: c.text })),
		kejadian_terbaru: (state.log ?? []).slice(-8).map((l) => l.msg)
	};
}

const SYSTEM = `Kamu adalah pemain BOT di permainan Monopoli bertema Indonesia "Jadi WNI". Kamu main untuk MENANG (kekayaan bersih tertinggi) sambil ramah & seru ngobrol dengan pemain lain.
Satuan uang = juta rupiah (jt). Kamu HANYA mengambil keputusan "lunak" di luar giliran: main saham, menawar properti pemain lain, menerima/menolak tawaran atas propertimu, menjual/menggadai propertimu kalau perlu uang, dan chat.
Prinsip: beli saham saat murah (di bawah/ dekat harga dasar), jual saat sudah untung; tawar properti yang melengkapi grup warnamu; terima tawaran yang menguntungkan; jangan sampai kehabisan uang tunai (sisakan cadangan untuk bayar sewa). Jangan menawar/menjual ke diri sendiri. Jangan mengarang id atau angka di luar data.
Balas HANYA JSON objek tanpa teks lain, bentuk:
{"chat": "pesan singkat ramah ke pemain (maks 140 char) atau kosong", "actions": [ ... ]}
Tiap action salah satu dari (pakai "tile" = nomor petak dari data, "sym" = kode saham, id penawar dari data):
{"type":"stockBuy","sym":"XXX","qty":10}
{"type":"stockSell","sym":"XXX","qty":10}
{"type":"mkOffer","tile":19,"price":250}
{"type":"mkAccept","tile":12,"buyer":"<penawar_id>"}
{"type":"mkReject","tile":12,"buyer":"<penawar_id>"}
{"type":"mkList","tile":8,"price":180}
{"type":"mkUnlist","tile":8}
{"type":"mortgage","tile":8}
{"type":"unmortgage","tile":8}
{"type":"sell","tile":8}
Maksimal ${MAX_ACTIONS} action. Kalau tidak ada yang perlu dilakukan, "actions": []. "chat" boleh kosong kalau tak ada yang menarik; balaslah kalau ada pemain menyapa/menawar.`;

async function askAI(state, bot, recentChat) {
	const res = await fetch(`${BASE()}/v1/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY ?? ''}` },
		body: JSON.stringify({
			model: MODEL(),
			max_tokens: 600,
			messages: [
				{ role: 'system', content: SYSTEM },
				{ role: 'user', content: `Kondisimu & papan sekarang:\n${JSON.stringify(snapshot(state, bot, recentChat), null, 1)}` }
			]
		}),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 160)}`);
	const data = await res.json();
	const raw = data.choices?.[0]?.message?.content ?? '';
	const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
	const obj = JSON.parse(json);
	const actions = Array.isArray(obj.actions) ? obj.actions.filter((a) => a && ALLOWED.has(a.type)).slice(0, MAX_ACTIONS) : [];
	const chat = typeof obj.chat === 'string' ? obj.chat.trim().slice(0, 140) : '';
	return { chat, actions };
}

/** @type {Map<string, {busy:boolean, nextAt:number, turn:number, lastChatAt:number}>} */
const brains = new Map();

/**
 * Dipanggil periodik. Untuk tiap bot aktif, sesekali konsultasi AI lalu terapkan aksinya + chat.
 * @param {Map<string,any>} rooms
 * @param {{ recentChat:(code:string)=>any[], sendChat:(code:string,bot:any,text:string)=>void, onChange:(state:any)=>void }} api
 */
export function tickBotAI(rooms, api, now = Date.now()) {
	if (!botAIEnabled()) return;
	for (const [code, state] of rooms) {
		if (state.status !== 'playing' || state.paused || state.ad) continue;
		for (const bot of state.players) {
			if (!bot.bot || bot.bankrupt) continue;
			const key = `${code}:${bot.id}`;
			let b = brains.get(key);
			if (!b) brains.set(key, (b = { busy: false, nextAt: now + Math.random() * THINK_INTERVAL_MS, turn: -1, lastChatAt: 0 }));
			if (b.busy || now < b.nextAt) continue;
			const { tawaranKeAku } = marketView(state, bot.id);
			// hemat token: hanya panggil AI kalau game maju sejak terakhir, ATAU ada tawaran masuk untuk bot
			if (state.turnCount === b.turn && tawaranKeAku.length === 0) {
				b.nextAt = now + THINK_INTERVAL_MS;
				continue;
			}
			b.busy = true;
			const recent = api.recentChat(code) ?? [];
			askAI(state, bot, recent)
				.then(({ chat, actions }) => {
					const live = rooms.get(code);
					if (!live || live.status !== 'playing') return;
					const self = live.players.find((p) => p.id === bot.id);
					if (!self || self.bankrupt) return;
					let changed = false;
					for (const a of actions) {
						try {
							applyAction(live, bot.id, a);
							changed = true;
						} catch (e) {
							if (!(e instanceof GameError)) throw e;
						}
					}
					if (changed) api.onChange(live);
					if (chat && Date.now() - b.lastChatAt >= CHAT_MIN_GAP_MS) {
						b.lastChatAt = Date.now();
						api.sendChat(code, self, chat);
					}
				})
				.catch((e) => console.error('[botAI]', e.message))
				.finally(() => {
					b.busy = false;
					b.turn = state.turnCount;
					b.nextAt = Date.now() + THINK_INTERVAL_MS;
				});
		}
	}
}
