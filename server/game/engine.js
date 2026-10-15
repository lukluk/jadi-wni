// Mesin aturan "Jadi WNI" — server-authoritative, mutasi state secara langsung.
import {
	TILES,
	GROUPS,
	CARDS,
	TOKENS,
	PLAYER_COLORS,
	START_MONEY,
	SALARY,
	JAIL_FINE,
	JAIL_INDEX,
	MAX_PLAYERS,
	MIN_PLAYERS,
	MAX_LEVEL,
	HOUSE_LEVELS,
	STATION_RENT,
	UTILITY_MULT,
	isOwnable,
	formatRp
} from '../../src/lib/shared/board.js';

export class GameError extends Error {}

const fail = (msg) => {
	throw new GameError(msg);
};

const LOG_LIMIT = 120;

function shuffle(arr, rng) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

function log(state, msg) {
	state.log.push({ t: Date.now(), msg });
	if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

const playerById = (state, id) => state.players.find((p) => p.id === id);
const current = (state) => state.players[state.turn];
const alive = (state) => state.players.filter((p) => !p.bankrupt);
const groupTiles = (group) => TILES.filter((t) => t.group === group);

export function createGame(code, host) {
	const state = {
		code,
		hostId: host.id,
		status: 'lobby',
		createdAt: Date.now(),
		players: [],
		tiles: {},
		turn: 0,
		phase: 'roll',
		dice: null,
		doubles: 0,
		extraRoll: false,
		pendingBuy: null,
		arisan: 0,
		decks: { musibah: [], takdir: [] },
		lastCard: null,
		seq: 0,
		turnCount: 0,
		winner: null,
		log: []
	};
	addPlayer(state, host);
	return state;
}

export function addPlayer(state, user) {
	if (playerById(state, user.id)) return;
	if (state.status !== 'lobby') fail('Game sudah dimulai.');
	if (state.players.length >= MAX_PLAYERS) fail(`Room penuh (maks ${MAX_PLAYERS} pemain).`);
	const usedTokens = new Set(state.players.map((p) => p.token));
	const usedColors = new Set(state.players.map((p) => p.color));
	state.players.push({
		id: user.id,
		name: user.name,
		avatar: user.avatar ?? null,
		token: TOKENS.find((t) => !usedTokens.has(t.id)).id,
		color: PLAYER_COLORS.find((c) => !usedColors.has(c)),
		money: START_MONEY,
		pos: 0,
		inJail: false,
		jailTurns: 0,
		jailFree: 0,
		bankrupt: false
	});
	log(state, `${user.name} masuk room.`);
}

export function removePlayer(state, userId) {
	if (state.status !== 'lobby') fail('Tidak bisa keluar saat game berjalan — gunakan Bangkrut.');
	const idx = state.players.findIndex((p) => p.id === userId);
	if (idx < 0) return;
	const [p] = state.players.splice(idx, 1);
	log(state, `${p.name} keluar room.`);
	if (state.hostId === userId && state.players.length) {
		state.hostId = state.players[0].id;
		log(state, `${state.players[0].name} sekarang jadi host.`);
	}
}

export function startGame(state, rng = Math.random) {
	if (state.status !== 'lobby') fail('Game sudah dimulai.');
	if (state.players.length < MIN_PLAYERS) fail(`Minimal ${MIN_PLAYERS} pemain.`);
	shuffle(state.players, rng);
	state.status = 'playing';
	state.turn = 0;
	state.phase = 'roll';
	state.decks.musibah = shuffle([...CARDS.musibah.keys()], rng);
	state.decks.takdir = shuffle([...CARDS.takdir.keys()], rng);
	log(state, `Game dimulai! Urutan: ${state.players.map((p) => p.name).join(' → ')}.`);
	log(state, `Giliran ${current(state).name}.`);
}

// ---------- uang ----------

/** bayar ke pemain lain (toId) atau ke Kas Arisan (toId = null) */
function pay(state, p, amount, toId = null) {
	if (amount <= 0) return;
	p.money -= amount;
	if (toId) {
		const to = playerById(state, toId);
		to.money += amount;
	} else {
		state.arisan += amount;
	}
}

// ---------- pergerakan ----------

function collectSalary(state, p) {
	p.money += SALARY;
	log(state, `${p.name} lewat GAJIAN, terima ${formatRp(SALARY)}.`);
}

function moveBy(state, p, steps) {
	const next = p.pos + steps;
	if (next >= TILES.length) collectSalary(state, p);
	p.pos = next % TILES.length;
}

function moveTo(state, p, target, { salary = true } = {}) {
	if (target === p.pos) return;
	if (salary && target < p.pos) collectSalary(state, p);
	p.pos = target;
}

function sendToJail(state, p) {
	p.pos = JAIL_INDEX;
	p.inJail = true;
	p.jailTurns = 0;
	state.doubles = 0;
	state.extraRoll = false;
	log(state, `${p.name} digiring ke Ruang Sidang Tilang! 🚔`);
}

// ---------- sewa ----------

function ownsGroup(state, ownerId, group) {
	return groupTiles(group).every((t) => state.tiles[t.i]?.owner === ownerId);
}

function countOwned(state, ownerId, type) {
	return TILES.filter((t) => t.type === type && state.tiles[t.i]?.owner === ownerId).length;
}

export function rentFor(state, tileIdx, diceTotal = 7) {
	const tile = TILES[tileIdx];
	const own = state.tiles[tileIdx];
	if (!own || own.mortgaged) return 0;
	if (tile.type === 'property') {
		if (own.level > 0) return tile.rent[own.level];
		return ownsGroup(state, own.owner, tile.group) ? tile.rent[0] * 2 : tile.rent[0];
	}
	if (tile.type === 'station') return STATION_RENT[countOwned(state, own.owner, 'station')];
	if (tile.type === 'utility') return UTILITY_MULT[countOwned(state, own.owner, 'utility')] * diceTotal;
	return 0;
}

// ---------- mendarat ----------

function landOn(state, p, rng, { rentMult = 1 } = {}) {
	const tile = TILES[p.pos];
	const diceTotal = state.dice ? state.dice[0] + state.dice[1] : 7;
	switch (tile.type) {
		case 'property':
		case 'station':
		case 'utility': {
			const own = state.tiles[tile.i];
			if (!own) {
				state.pendingBuy = tile.i;
				log(state, `${p.name} mendarat di ${tile.name} (dijual ${formatRp(tile.price)}).`);
				return;
			}
			if (own.owner === p.id) {
				log(state, `${p.name} mampir ke ${tile.name} miliknya sendiri.`);
				return;
			}
			if (own.mortgaged) {
				log(state, `${p.name} di ${tile.name} — sedang digadai, bebas sewa.`);
				return;
			}
			const rent = rentFor(state, tile.i, diceTotal) * rentMult;
			const owner = playerById(state, own.owner);
			pay(state, p, rent, owner.id);
			log(state, `${p.name} bayar sewa ${formatRp(rent)} ke ${owner.name} di ${tile.name}.`);
			return;
		}
		case 'tax':
			pay(state, p, tile.amount);
			log(state, `${p.name} bayar ${tile.name} ${formatRp(tile.amount)} (masuk Kas Arisan).`);
			return;
		case 'musibah':
		case 'takdir':
			drawCard(state, p, tile.type, rng);
			return;
		case 'arisan':
			if (state.arisan > 0) {
				log(state, `${p.name} menang arisan! Ambil ${formatRp(state.arisan)} 🎉`);
				p.money += state.arisan;
				state.arisan = 0;
			} else {
				log(state, `${p.name} menang arisan... tapi kasnya kosong.`);
			}
			return;
		case 'gotojail':
			sendToJail(state, p);
			return;
		default:
			return;
	}
}

// ---------- kartu ----------

const JAIL_FREE_CARD = CARDS.takdir.findIndex((c) => c.fx.jailFree);

function drawCard(state, p, deck, rng) {
	if (!state.decks[deck].length) {
		// semua kartu (selain Pemutihan yang dipegang) dikocok ulang
		const held = state.players.reduce((n, x) => n + x.jailFree, 0);
		state.decks[deck] = shuffle(
			[...CARDS[deck].keys()].filter((k) => !(deck === 'takdir' && k === JAIL_FREE_CARD && held > 0)),
			rng
		);
	}
	const idx = state.decks[deck].shift();
	const card = CARDS[deck][idx];
	state.seq += 1;
	state.lastCard = { seq: state.seq, deck, text: card.text, playerId: p.id, playerName: p.name };
	log(state, `${p.name} ambil kartu ${deck === 'musibah' ? 'Musibah' : 'Takdir'}: "${card.text}"`);

	const fx = card.fx;
	if (fx.jailFree) {
		p.jailFree += 1;
		return; // kartu disimpan, tidak kembali ke deck
	}
	state.decks[deck].push(idx);

	if (fx.money > 0) p.money += fx.money;
	if (fx.money < 0) pay(state, p, -fx.money);
	if (fx.jail) sendToJail(state, p);
	if (fx.repairs) {
		const [perHouse, perOkb] = fx.repairs;
		let total = 0;
		for (const [i, t] of Object.entries(state.tiles)) {
			if (t.owner !== p.id || TILES[+i].type !== 'property') continue;
			total += t.level === MAX_LEVEL ? perOkb : t.level * perHouse;
		}
		if (total > 0) {
			pay(state, p, total);
			log(state, `${p.name} bayar ${formatRp(total)} untuk perbaikan rumah.`);
		} else {
			log(state, `${p.name} belum punya rumah, lolos!`);
		}
	}
	if (fx.each) {
		for (const other of alive(state)) {
			if (other.id === p.id) continue;
			if (fx.each > 0) pay(state, other, fx.each, p.id);
			else pay(state, p, -fx.each, other.id);
		}
	}
	if (fx.back) {
		p.pos = (p.pos - fx.back + TILES.length) % TILES.length;
		landOn(state, p, rng);
	}
	if (fx.moveTo !== undefined) {
		moveTo(state, p, fx.moveTo);
		landOn(state, p, rng);
	}
	if (fx.nearestStation) {
		let i = p.pos;
		do i = (i + 1) % TILES.length;
		while (TILES[i].type !== 'station');
		moveTo(state, p, i);
		landOn(state, p, rng, { rentMult: 2 });
	}
}

// ---------- aksi giliran ----------

function requireTurn(state, userId) {
	if (state.status !== 'playing') fail('Game belum berjalan.');
	const p = current(state);
	if (p.id !== userId) fail('Bukan giliranmu.');
	return p;
}

function afterResolve(state) {
	if (state.pendingBuy !== null) state.phase = 'buy';
	else state.phase = state.extraRoll ? 'roll' : 'end';
}

function doRoll(state, p, rng) {
	if (state.phase !== 'roll') fail('Belum saatnya lempar dadu.');
	if (p.money < 0) fail('Lunasi utang dulu (jual rumah / gadai) sebelum lempar dadu.');
	const d = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
	const isDouble = d[0] === d[1];
	state.dice = d;
	state.seq += 1;
	state.extraRoll = false;
	log(state, `${p.name} lempar dadu: ${d[0]} + ${d[1]}${isDouble ? ' (dobel!)' : ''}.`);

	if (p.inJail) {
		if (isDouble) {
			p.inJail = false;
			p.jailTurns = 0;
			log(state, `${p.name} dobel, bebas dari Ruang Sidang.`);
		} else {
			p.jailTurns += 1;
			if (p.jailTurns >= 3) {
				pay(state, p, JAIL_FINE);
				p.inJail = false;
				p.jailTurns = 0;
				log(state, `${p.name} sudah 3 giliran, wajib bayar denda ${formatRp(JAIL_FINE)}.`);
			} else {
				log(state, `${p.name} masih menunggu sidang (${p.jailTurns}/3).`);
				state.phase = 'end';
				return;
			}
		}
	} else if (isDouble) {
		state.doubles += 1;
		if (state.doubles >= 3) {
			log(state, `${p.name} dobel 3 kali — dicurigai ngebut!`);
			sendToJail(state, p);
			state.phase = 'end';
			return;
		}
		state.extraRoll = true;
	}

	moveBy(state, p, d[0] + d[1]);
	landOn(state, p, rng);
	if (p.inJail) state.extraRoll = false;
	afterResolve(state);
}

function nextTurn(state) {
	state.doubles = 0;
	state.extraRoll = false;
	state.pendingBuy = null;
	state.phase = 'roll';
	if (alive(state).length <= 1) return;
	do state.turn = (state.turn + 1) % state.players.length;
	while (current(state).bankrupt);
	state.turnCount += 1;
	log(state, `Giliran ${current(state).name}.`);
}

function checkWinner(state) {
	const left = alive(state);
	if (state.status === 'playing' && left.length <= 1) {
		state.status = 'ended';
		state.winner = left[0]?.id ?? null;
		log(state, `🏆 ${left[0]?.name ?? 'Tidak ada'} jadi WNI paling sukses! Game selesai.`);
	}
}

export function netWorth(state, p) {
	let total = p.money;
	for (const [i, t] of Object.entries(state.tiles)) {
		if (t.owner !== p.id) continue;
		const tile = TILES[+i];
		total += t.mortgaged ? tile.price / 2 : tile.price;
		if (tile.type === 'property') total += t.level * GROUPS[tile.group].houseCost;
	}
	return total;
}

function goBankrupt(state, p) {
	p.bankrupt = true;
	for (const [i, t] of Object.entries(state.tiles)) if (t.owner === p.id) delete state.tiles[i];
	p.jailFree = 0;
	log(state, `💸 ${p.name} bangkrut! Semua asetnya disita bank.`);
	const wasCurrent = current(state).id === p.id;
	checkWinner(state);
	if (state.status === 'playing' && wasCurrent) nextTurn(state);
}

// ---------- properti ----------

function requireOwner(state, userId, tileIdx) {
	if (state.status !== 'playing') fail('Game belum berjalan.');
	const p = playerById(state, userId);
	if (!p || p.bankrupt) fail('Kamu bukan pemain aktif.');
	const tile = TILES[tileIdx];
	if (!tile || !isOwnable(tile)) fail('Petak ini tidak bisa dimiliki.');
	const own = state.tiles[tileIdx];
	if (!own || own.owner !== userId) fail(`${tile.name} bukan milikmu.`);
	return { p, tile, own };
}

function build(state, userId, tileIdx) {
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	if (tile.type !== 'property') fail('Hanya kota yang bisa dibangun rumah.');
	if (!ownsGroup(state, userId, tile.group)) fail(`Kuasai semua kota grup ${GROUPS[tile.group].label} dulu.`);
	const group = groupTiles(tile.group).map((t) => state.tiles[t.i]);
	if (group.some((t) => t.mortgaged)) fail('Ada kota di grup ini yang sedang digadai.');
	if (own.level >= MAX_LEVEL) fail('Sudah Rumah OKB, mentok!');
	if (own.level > Math.min(...group.map((t) => t.level)))
		fail('Bangun merata dulu di kota lain dalam grup ini.');
	const cost = GROUPS[tile.group].houseCost;
	if (p.money < cost) fail(`Uang kurang, butuh ${formatRp(cost)}.`);
	p.money -= cost;
	own.level += 1;
	log(state, `${p.name} bangun ${HOUSE_LEVELS[own.level].name} di ${tile.name} (${formatRp(cost)}).`);
}

function sell(state, userId, tileIdx) {
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	if (tile.type !== 'property' || own.level === 0) fail('Tidak ada rumah untuk dijual.');
	const group = groupTiles(tile.group).map((t) => state.tiles[t.i]);
	if (own.level < Math.max(...group.map((t) => t.level)))
		fail('Jual merata dulu dari kota yang rumahnya lebih tinggi.');
	const refund = GROUPS[tile.group].houseCost / 2;
	const from = HOUSE_LEVELS[own.level].name;
	own.level -= 1;
	p.money += refund;
	log(state, `${p.name} jual ${from} di ${tile.name}, terima ${formatRp(refund)}.`);
}

function mortgage(state, userId, tileIdx) {
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	if (own.mortgaged) fail('Sudah digadai.');
	if (tile.type === 'property' && groupTiles(tile.group).some((t) => (state.tiles[t.i]?.level ?? 0) > 0))
		fail('Jual dulu semua rumah di grup ini.');
	own.mortgaged = true;
	p.money += tile.price / 2;
	log(state, `${p.name} gadai ${tile.name} ke Pegadaian, terima ${formatRp(tile.price / 2)}.`);
}

export const redeemCost = (tile) => Math.ceil((tile.price / 2) * 1.1);

function unmortgage(state, userId, tileIdx) {
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	if (!own.mortgaged) fail('Tidak sedang digadai.');
	const cost = redeemCost(tile);
	if (p.money < cost) fail(`Uang kurang, butuh ${formatRp(cost)}.`);
	p.money -= cost;
	own.mortgaged = false;
	log(state, `${p.name} tebus ${tile.name} dari Pegadaian (${formatRp(cost)}).`);
}

// ---------- dispatcher ----------

/**
 * @param {any} state
 * @param {string} userId
 * @param {{type:string, tile?:number}} action
 * @param {() => number} rng
 */
export function applyAction(state, userId, action, rng = Math.random) {
	switch (action?.type) {
		case 'roll':
			return doRoll(state, requireTurn(state, userId), rng);

		case 'buy': {
			const p = requireTurn(state, userId);
			if (state.phase !== 'buy') fail('Tidak ada properti untuk dibeli.');
			const tile = TILES[state.pendingBuy];
			if (p.money < tile.price) fail(`Uang kurang, butuh ${formatRp(tile.price)}.`);
			p.money -= tile.price;
			state.tiles[tile.i] = { owner: p.id, level: 0, mortgaged: false };
			log(state, `${p.name} beli ${tile.name} seharga ${formatRp(tile.price)}. 📜`);
			state.pendingBuy = null;
			return afterResolve(state);
		}

		case 'skip': {
			const p = requireTurn(state, userId);
			if (state.phase !== 'buy') fail('Tidak ada yang dilewati.');
			log(state, `${p.name} tidak jadi beli ${TILES[state.pendingBuy].name}.`);
			state.pendingBuy = null;
			return afterResolve(state);
		}

		case 'payJail': {
			const p = requireTurn(state, userId);
			if (!p.inJail || state.phase !== 'roll') fail('Kamu tidak di Ruang Sidang.');
			if (p.money < JAIL_FINE) fail('Uang tidak cukup untuk denda.');
			pay(state, p, JAIL_FINE);
			p.inJail = false;
			p.jailTurns = 0;
			log(state, `${p.name} bayar denda tilang ${formatRp(JAIL_FINE)}, bebas.`);
			return;
		}

		case 'useJailFree': {
			const p = requireTurn(state, userId);
			if (!p.inJail || state.phase !== 'roll') fail('Kamu tidak di Ruang Sidang.');
			if (p.jailFree < 1) fail('Kamu tidak punya kartu Pemutihan.');
			p.jailFree -= 1;
			p.inJail = false;
			p.jailTurns = 0;
			state.decks.takdir.push(JAIL_FREE_CARD);
			log(state, `${p.name} pakai kartu Pemutihan, bebas.`);
			return;
		}

		case 'endTurn': {
			const p = requireTurn(state, userId);
			if (state.phase !== 'end') fail('Selesaikan aksimu dulu.');
			if (p.money < 0) fail('Saldo minus! Jual rumah, gadai properti, atau nyatakan bangkrut.');
			return nextTurn(state);
		}

		case 'build':
			return build(state, userId, action.tile);
		case 'sell':
			return sell(state, userId, action.tile);
		case 'mortgage':
			return mortgage(state, userId, action.tile);
		case 'unmortgage':
			return unmortgage(state, userId, action.tile);

		case 'bankrupt': {
			if (state.status !== 'playing') fail('Game belum berjalan.');
			const p = playerById(state, userId);
			if (!p || p.bankrupt) fail('Kamu bukan pemain aktif.');
			return goBankrupt(state, p);
		}

		case 'endGame': {
			if (state.hostId !== userId) fail('Hanya host yang bisa mengakhiri game.');
			if (state.status !== 'playing') fail('Game belum berjalan.');
			const ranked = alive(state)
				.map((p) => ({ p, w: netWorth(state, p) }))
				.sort((a, b) => b.w - a.w);
			state.status = 'ended';
			state.winner = ranked[0].p.id;
			log(
				state,
				`Host mengakhiri game. 🏆 ${ranked[0].p.name} menang dengan kekayaan ${formatRp(ranked[0].w)}.`
			);
			return;
		}

		default:
			fail('Aksi tidak dikenal.');
	}
}

/** Paksa lewati giliran pemain yang terputus. */
export function forceSkip(state, byUserId) {
	if (state.status !== 'playing') fail('Game belum berjalan.');
	const p = current(state);
	const by = playerById(state, byUserId);
	if (!by) fail('Hanya pemain yang bisa melewati giliran.');
	log(state, `${by.name} melewati giliran ${p.name} (terputus).`);
	if (p.money < 0) return goBankrupt(state, p);
	nextTurn(state);
}

/** State untuk dikirim ke client (tanpa urutan deck). */
export function publicState(state) {
	const { decks, ...rest } = state;
	return { ...rest, deckSizes: { musibah: decks.musibah.length, takdir: decks.takdir.length } };
}
