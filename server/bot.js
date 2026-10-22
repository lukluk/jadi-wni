// Bot AI: pemain komputer yang ikut room kalau host sendirian > 1 menit, lalu main seperti pemain biasa
// (beli properti, bangun rumah, gadai/tebus, jual-beli saham, buka usaha, bayar sewa, keluar Ruang Sidang, menyerah kalau terjepit).
import { TILES, GROUPS, STOCKS, USAHA, JAIL_FINE, maxLevelOf, buildCost, maxPlayers } from '../src/lib/shared/board.js';
import { addPlayer, applyAction, redeemCost, GameError } from './game/engine.js';

export const BOT_JOIN_AFTER_MS = 60_000;
const BOT_NAMES = ['Rudi', 'Siti', 'Joko', 'Dewi', 'Agus', 'Wati', 'Bambang', 'Rini', 'Tono', 'Sari'];

/**
 * Tambahkan satu bot kalau room masih lobi, hanya berisi satu orang selama >= 1 menit, dan belum pernah diberi bot.
 * @returns {boolean} true kalau state berubah
 */
export function maybeAddBot(state, now = Date.now(), rng = Math.random) {
	if (state.status !== 'lobby' || state.botOffered) return false;
	if (state.players.length !== 1 || state.players.length >= maxPlayers(state)) return false;
	if (now - state.createdAt < BOT_JOIN_AFTER_MS) return false;
	state.botOffered = true;
	const name = `${BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]} (bot)`;
	addPlayer(state, { id: nextBotId(state), name });
	state.players[state.players.length - 1].bot = true;
	return true;
}

/** id unik untuk bot berikutnya di room ini (bot:<code>:<n>). */
function nextBotId(state) {
	const used = new Set(state.players.map((p) => p.id));
	let n = 1;
	while (used.has(`bot:${state.code}:${n}`)) n++;
	return `bot:${state.code}:${n}`;
}

/**
 * Host menambah satu bot secara manual, dengan nama pilihannya (opsional — kosong = nama acak).
 * Nama selalu diberi akhiran "(bot)" supaya pemain lain tahu itu komputer.
 * @returns {object} pemain bot yang baru ditambahkan
 */
export function addBot(state, name, rng = Math.random) {
	if (state.status !== 'lobby') throw new GameError('Game sudah dimulai.');
	if (state.players.length >= maxPlayers(state)) throw new GameError(`Room penuh (maks ${maxPlayers(state)} pemain).`);
	let base = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
	if (!base) base = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
	const display = /\(bot\)\s*$/i.test(base) ? base : `${base} (bot)`;
	const id = nextBotId(state);
	addPlayer(state, { id, name: display });
	const bot = state.players[state.players.length - 1];
	bot.bot = true;
	// host sudah pegang kendali isi room; jangan tambah bot otomatis lagi belakangan
	state.botOffered = true;
	return bot;
}

const tryAct = (state, id, action) => {
	try {
		applyAction(state, id, action);
		return true;
	} catch (e) {
		if (e instanceof GameError) return false;
		throw e;
	}
};

const owned = (state, id) => Object.entries(state.tiles).filter(([, t]) => t.owner === id).map(([i, t]) => ({ i: +i, tile: TILES[+i], own: t }));
const ownsGroup = (state, id, group) => TILES.filter((t) => t.group === group).every((t) => state.tiles[t.i]?.owner === id);

/** kas minimal yang dijaga bot supaya tidak langsung bangkrut kena sewa */
const reserveOf = (state, p) => 220 + Math.min(280, owned(state, p.id).length * 22);

/** cari uang tunai dengan satu langkah: jual saham -> jual rumah -> gadai. false kalau sudah habis akal. */
function raiseCash(state, p) {
	const act = (a) => tryAct(state, p.id, a);
	for (const [sym, h] of Object.entries(p.stocks ?? {})) if (h.qty > 0 && act({ type: 'stockSell', sym, qty: h.qty })) return true;
	const houses = owned(state, p.id)
		.filter((x) => x.tile.type === 'property' && x.own.level > 0)
		.sort((a, b) => b.own.level - a.own.level);
	for (const x of houses) if (act({ type: 'sell', tile: x.i })) return true;
	const mortgageable = owned(state, p.id)
		.filter((x) => !x.own.mortgaged)
		.sort((a, b) => b.tile.price - a.tile.price);
	for (const x of mortgageable) if (act({ type: 'mortgage', tile: x.i })) return true;
	return false;
}

/** langkah investasi/pengembangan di akhir giliran. true kalau ada aksi. */
function develop(state, p) {
	const act = (a) => tryAct(state, p.id, a);
	const reserve = reserveOf(state, p);

	// tebus properti yang digadai kalau kas longgar
	for (const x of owned(state, p.id).filter((x) => x.own.mortgaged).sort((a, b) => b.tile.price - a.tile.price))
		if (p.money - redeemCost(x.tile) >= reserve + 150 && act({ type: 'unmortgage', tile: x.i })) return true;

	// bangun rumah di grup yang sudah dikuasai penuh (merata: level terendah & termurah dulu)
	const buildable = owned(state, p.id)
		.filter((x) => x.tile.type === 'property' && !x.own.mortgaged && x.own.level < maxLevelOf(x.tile) && ownsGroup(state, p.id, x.tile.group))
		.map((x) => ({ ...x, cost: buildCost(GROUPS[x.tile.group].houseCost, x.own.level + 1) }))
		.sort((a, b) => a.own.level - b.own.level || a.cost - b.cost);
	for (const x of buildable) {
		const extra = x.own.level + 1 >= 5 ? 200 : 0; // Kebun Sawit mahal, butuh kas lebih
		if (p.money - x.cost >= reserve + extra && act({ type: 'build', tile: x.i })) return true;
	}

	// buka usaha kalau belum punya & kas cukup: ambil yang terbesar yang masih mampu (sisakan cadangan)
	if (!p.usaha) {
		const pick = [...USAHA].sort((a, b) => b.cost - a.cost).find((u) => p.money - u.cost >= reserve + 100);
		if (pick && act({ type: 'buildUsaha', id: pick.id })) return true;
	}

	// saham: sekali per giliran
	if (p.botStockTurn !== state.turnCount) {
		p.botStockTurn = state.turnCount;
		// ambil untung kalau naik >= 25%, atau cut loss kalau turun >= 35%
		for (const [sym, h] of Object.entries(p.stocks ?? {})) {
			const price = state.stocks?.[sym]?.price ?? 0;
			const val = price * h.qty;
			if (h.qty > 0 && (val >= h.cost * 1.25 || val <= h.cost * 0.65) && act({ type: 'stockSell', sym, qty: h.qty })) return true;
		}
		// beli saham: "beli yang murah" — pilih rasio harga/dasar terendah selama belum kemahalan
		// (<= 1,25x harga dasar), pakai ~35% kas bebas. Longgar supaya bot aktif ikut pasar.
		const free = p.money - reserve - 120;
		if (free >= 60) {
			const cand = STOCKS.map((s) => ({ s, price: state.stocks?.[s.sym]?.price ?? s.base }))
				.map((x) => ({ ...x, ratio: x.price / x.s.base }))
				.filter((x) => x.ratio <= 1.25)
				.sort((a, b) => a.ratio - b.ratio);
			if (cand.length) {
				const pick = cand[0];
				const qty = Math.floor((free * 0.35) / pick.price);
				if (qty >= 1 && act({ type: 'stockBuy', sym: pick.s.sym, qty })) return true;
			}
		}
	}
	return false;
}

/**
 * Satu langkah bot untuk pemain bot yang sedang giliran.
 * @returns {boolean} true kalau state berubah
 */
export function botStep(state) {
	// bot menolak ajakan merger (dibentuk di lobby) biar tak menggantung sampai kadaluarsa
	if (state.mergeOffer) {
		const target = state.players.find((x) => x.id === state.mergeOffer.to);
		if (target?.bot) return tryAct(state, target.id, { type: 'mergeReject' });
	}
	if (state.status !== 'playing') return false;
	const p = state.players[state.turn];
	if (!p?.bot || p.bankrupt) return false;
	const act = (a) => tryAct(state, p.id, a);
	const reserve = reserveOf(state, p);

	if (state.phase === 'rent') {
		const need = state.pendingRent?.amount ?? 0;
		if (p.money >= need) return act({ type: 'payRent' });
		return raiseCash(state, p) || act({ type: 'bankrupt' });
	}

	if (state.phase === 'buy') {
		const tile = TILES[state.pendingBuy];
		const completes = tile.group && TILES.filter((t) => t.group === tile.group && t.i !== tile.i).every((t) => state.tiles[t.i]?.owner === p.id);
		const ok = p.money - tile.price >= (completes ? 40 : reserve);
		return (ok && act({ type: 'buy' })) || act({ type: 'skip' });
	}

	if (state.phase === 'roll') {
		if (p.money < 0) return raiseCash(state, p) || act({ type: 'bankrupt' });
		if (p.inJail) {
			if (p.jailFree > 0 && act({ type: 'useJailFree' })) return true;
			if (p.money - JAIL_FINE >= reserve && act({ type: 'payJail' })) return true;
		}
		return act({ type: 'roll' });
	}

	if (state.phase === 'end') {
		if (p.money < 0) return raiseCash(state, p) || act({ type: 'bankrupt' });
		if (develop(state, p)) return true;
		return act({ type: 'endTurn' });
	}
	return false;
}
