// Bot AI: pemain komputer yang ikut room kalau host sendirian > 1 menit, lalu main seperti pemain biasa
// (beli properti, bangun rumah, gadai/tebus, jual-beli saham, bayar sewa, keluar Ruang Sidang, menyerah kalau terjepit).
import { TILES, GROUPS, STOCKS, JAIL_FINE, maxLevelOf, buildCost, MAX_PLAYERS } from '../src/lib/shared/board.js';
import { addPlayer, applyAction, redeemCost, GameError } from './game/engine.js';

export const BOT_JOIN_AFTER_MS = 60_000;
const BOT_NAMES = ['Rudi', 'Siti', 'Joko', 'Dewi', 'Agus', 'Wati', 'Bambang', 'Rini', 'Tono', 'Sari'];

/**
 * Tambahkan satu bot kalau room masih lobi, hanya berisi satu orang selama >= 1 menit, dan belum pernah diberi bot.
 * @returns {boolean} true kalau state berubah
 */
export function maybeAddBot(state, now = Date.now(), rng = Math.random) {
	if (state.status !== 'lobby' || state.botOffered) return false;
	if (state.players.length !== 1 || state.players.length >= MAX_PLAYERS) return false;
	if (now - state.createdAt < BOT_JOIN_AFTER_MS) return false;
	state.botOffered = true;
	const name = `${BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]} (bot)`;
	addPlayer(state, { id: `bot:${state.code}:1`, name });
	state.players[state.players.length - 1].bot = true;
	return true;
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

	// saham: sekali per giliran
	if (p.botStockTurn !== state.turnCount) {
		p.botStockTurn = state.turnCount;
		// ambil untung kalau naik >= 25% dari harga rata-rata beli
		for (const [sym, h] of Object.entries(p.stocks ?? {})) {
			const price = state.stocks?.[sym]?.price ?? 0;
			if (h.qty > 0 && price * h.qty >= h.cost * 1.25 && act({ type: 'stockSell', sym, qty: h.qty })) return true;
		}
		// beli saham yang sedang murah (di bawah harga dasar) pakai maksimal 30% kas bebas
		const free = p.money - reserve - 150;
		if (free >= 40) {
			const cheap = STOCKS.map((s) => ({ s, price: state.stocks?.[s.sym]?.price ?? s.base })).filter((x) => x.price <= x.s.base * 1.0);
			if (cheap.length) {
				const pick = cheap[Math.floor(Math.random() * cheap.length)];
				const qty = Math.floor((free * 0.3) / pick.price);
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
