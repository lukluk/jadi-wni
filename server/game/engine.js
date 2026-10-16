// Mesin aturan "Jadi WNI" — server-authoritative, mutasi state secara langsung.
import {
	isCardKey,
	TILES,
	GROUPS,
	CARDS,
	TOKENS,
	PLAYER_COLORS,
	START_MONEY,
	JAIL_FINE,
	JAIL_INDEX,
	MAX_PLAYERS,
	MIN_PLAYERS,
	maxLevelOf,
	canSawit,
	OKB_LEVEL,
	SAWIT_LEVEL,
	STOCKS,
	STOCK_HISTORY,
	salaryFor,
	buildCost,
	investedCost,
	HOUSE_LEVELS,
	STATION_RENT,
	UTILITY_MULT,
	isOwnable,
	formatRp,
	stockValue,
	netWorth,
	surrenderPlan,
	candlesOf,
	WIN_NETWORTH
} from '../../src/lib/shared/board.js';

export { stockValue, netWorth };

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
		market: {},
		stocks: initStocks(),
		turn: 0,
		phase: 'roll',
		dice: null,
		rollSeq: 0,
		doubles: 0,
		extraRoll: false,
		pendingBuy: null,
		pendingRent: null,
		kasNegara: 0,
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
		stocks: {},
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
	// bot tidak ditinggal sendirian di room tanpa manusia, dan tidak jadi host
	if (state.players.every((x) => x.bot)) state.players.length = 0;
	if (state.hostId === userId && state.players.length) {
		const next = state.players.find((x) => !x.bot) ?? state.players[0];
		state.hostId = next.id;
		log(state, `${next.name} sekarang jadi host.`);
	}
}

export function startGame(state, rng = Math.random) {
	if (state.status !== 'lobby') fail('Game sudah dimulai.');
	if (state.players.length < MIN_PLAYERS) fail(`Minimal ${MIN_PLAYERS} pemain.`);
	shuffle(state.players, rng);
	state.status = 'playing';
	const now = new Date();
	state.calBase = { y: now.getFullYear(), m: now.getMonth() };
	state.turn = 0;
	state.phase = 'roll';
	state.decks.musibah = shuffle([...CARDS.musibah.keys()], rng);
	state.decks.takdir = shuffle([...CARDS.takdir.keys()], rng);
	log(state, `Game dimulai! Urutan: ${state.players.map((p) => p.name).join(' → ')}.`);
	log(state, `Giliran ${current(state).name}.`);
}

// ---------- uang ----------

/** bayar ke pemain lain (toId) atau ke Kas Negara (toId = null) */
function pay(state, p, amount, toId = null) {
	if (amount <= 0) return;
	p.money -= amount;
	if (toId) {
		const to = playerById(state, toId);
		to.money += amount;
	} else {
		state.kasNegara += amount;
	}
}

// ---------- pergerakan ----------

function collectSalary(state, p) {
	const { sawit, bonus, amount } = salaryFor(state.tiles, p.id);
	p.money += amount;
	p.laps = (p.laps ?? 0) + 1;
	log(
		state,
		`${p.name} lewat GAJIAN, terima ${formatRp(amount)}${sawit ? ` (bonus ${sawit} Kebun Sawit ${formatRp(bonus)})` : ''}.`
	);
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
				// sewa tidak otomatis: pemain yang mendarat harus menyetujui (tombol Bayar)
			state.pendingRent = { tile: tile.i, amount: rent, deadline: Date.now() + RENT_TIMEOUT_MS + RENT_GRACE_MS };
			log(state, `${p.name} mendarat di ${tile.name} milik ${owner.name}, sewa ${formatRp(rent)}.`);
			return;
		}
		case 'tax':
			pay(state, p, tile.amount);
			state.seq += 1;
			state.lastCard = {
				seq: state.seq,
				deck: 'tax',
				text: `Waduh, bayar ${tile.short ?? tile.name} ya!`,
				amount: tile.amount,
				playerId: p.id,
				playerName: p.name
			};
			log(state, `${p.name} bayar ${tile.name} ${formatRp(tile.amount)} (masuk Kas Negara).`);
			return;
		case 'musibah':
		case 'takdir':
			drawCard(state, p, tile.type, rng);
			return;
		case 'bansos':
			if (state.kasNegara > 0) {
				log(state, `${p.name} dapat bansos! Ambil seluruh Kas Negara ${formatRp(state.kasNegara)} 🏛️`);
				p.money += state.kasNegara;
				state.kasNegara = 0;
			} else {
				log(state, `${p.name} antre bansos... tapi Kas Negara kosong.`);
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

/** Karhutla: semua Kebun Sawit hangus -> Rumah OKB, pemilik kena denda sebesar biaya bangun sawit (ke Kas Negara) */
function burnSawit(state) {
	let burned = 0;
	for (const [i, t] of Object.entries(state.tiles)) {
		const tile = TILES[+i];
		if (tile.type !== 'property' || t.level !== SAWIT_LEVEL) continue;
		const owner = playerById(state, t.owner);
		if (!owner || owner.bankrupt) continue;
		const fine = buildCost(GROUPS[tile.group].houseCost, SAWIT_LEVEL);
		t.level = OKB_LEVEL;
		pay(state, owner, fine);
		burned += 1;
		log(state, `🔥 Kebun Sawit ${owner.name} di ${tile.name} hangus terbakar! Denda lingkungan ${formatRp(fine)}.`);
	}
	if (!burned) log(state, '🔥 Karhutla, tapi tidak ada Kebun Sawit yang terbakar. Untung!');
}

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
			total += t.level >= OKB_LEVEL ? perOkb : t.level * perHouse;
		}
		if (total > 0) {
			pay(state, p, total);
			log(state, `${p.name} bayar ${formatRp(total)} untuk perbaikan rumah.`);
		} else {
			log(state, `${p.name} belum punya rumah, lolos!`);
		}
	}
	if (fx.karhutla) burnSawit(state);
	if (fx.each) {
		for (const other of alive(state)) {
			if (other.id === p.id) continue;
			if (fx.each > 0) pay(state, other, fx.each, p.id);
			else pay(state, p, -fx.each, other.id);
		}
	}
	if (fx.back) {
		if (p.pos - fx.back < 0) p.laps = (p.laps ?? 0) - 1;
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
	if (state.pendingRent) state.phase = 'rent';
	else if (state.pendingBuy !== null) state.phase = 'buy';
	else state.phase = state.extraRoll ? 'roll' : 'end';
}

function doRoll(state, p, rng) {
	if (state.phase !== 'roll') fail('Belum saatnya lempar dadu.');
	if (p.money < 0) fail('Lunasi utang dulu (jual rumah / gadai) sebelum lempar dadu.');
	const d = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
	const isDouble = d[0] === d[1];
	state.dice = d;
	state.rollSeq = (state.rollSeq ?? 0) + 1;
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
	state.pendingRent = null;
	state.phase = 'roll';
	if (alive(state).length <= 1) return;
	tickStocks(state);
	do state.turn = (state.turn + 1) % state.players.length;
	while (current(state).bankrupt);
	state.turnCount += 1;
	log(state, `Giliran ${current(state).name}.`);
	checkWinner(state);
}

function checkWinner(state) {
	const left = alive(state);
	if (state.status === 'playing') {
		const rich = left.filter((p) => netWorth(state, p) >= WIN_NETWORTH).sort((a, b) => netWorth(state, b) - netWorth(state, a))[0];
		if (rich) {
			state.status = 'ended';
			state.winner = rich.id;
			log(state, `🏆 ${rich.name} tembus ${formatRp(WIN_NETWORTH)} dan jadi WNI paling sukses! Game selesai.`);
			return;
		}
	}
	if (state.status === 'playing' && left.length <= 1) {
		state.status = 'ended';
		state.winner = left[0]?.id ?? null;
		log(state, `🏆 ${left[0]?.name ?? 'Tidak ada'} jadi WNI paling sukses! Game selesai.`);
	}
}


/** waktu menyelesaikan tagihan; +grace untuk animasi dadu/bidak sebelum popup muncul */
export const RENT_TIMEOUT_MS = 120_000;
export const RENT_GRACE_MS = 6_000;

/** waktu tagihan habis = menyerah (aset ke penagih). true kalau terjadi. */
export function expireRent(state, now = Date.now()) {
	const r = state.pendingRent;
	if (state.status !== 'playing' || state.phase !== 'rent' || !r?.deadline || now < r.deadline) return false;
	const p = current(state);
	log(state, `⏰ Waktu habis! ${p.name} tidak menyelesaikan tagihan dan dianggap menyerah.`);
	surrender(state, p);
	return true;
}

// ---------- vote kick ----------
export const KICK_RATIO = 0.7;
export const KICK_TIMEOUT_MS = 45_000;
const KICK_COOLDOWN_MS = 30_000;

/** pemilih = pemain aktif selain yang akan dikeluarkan */
export const kickVoters = (state) => alive(state).filter((p) => !p.bot && p.id !== state.kickVote?.target);
export const kickNeeded = (state) => Math.ceil(kickVoters(state).length * KICK_RATIO - 1e-9);

function kickTally(state) {
	const k = state.kickVote;
	if (!k) return;
	const target = playerById(state, k.target);
	const voters = kickVoters(state);
	if (state.status !== 'playing' || !target || target.bankrupt || voters.length < 2) {
		state.kickVote = null;
		return;
	}
	const need = kickNeeded(state);
	const yes = voters.filter((v) => k.votes[v.id] === true).length;
	const no = voters.filter((v) => k.votes[v.id] === false).length;
	if (yes >= need) {
		state.kickVote = null;
		log(state, `🗳️ ${yes}/${voters.length} pemain setuju: ${target.name} dikeluarkan dari game.`);
		goBankrupt(state, target);
	} else if (voters.length - no < need) {
		state.kickVote = null;
		state.kickCoolUntil = Date.now() + KICK_COOLDOWN_MS;
		log(state, `🗳️ Voting keluarkan ${target.name} gagal (butuh ${need} setuju dari ${voters.length}).`);
	}
}

/** dipanggil server tiap detik: voting kadaluarsa / berubah karena pemain bangkrut. true kalau state berubah. */
export function expireKick(state, now = Date.now()) {
	const k = state.kickVote;
	if (!k) return false;
	if (now >= k.deadline) {
		const t = playerById(state, k.target);
		state.kickVote = null;
		state.kickCoolUntil = now + KICK_COOLDOWN_MS;
		log(state, `🗳️ Voting keluarkan ${t?.name ?? 'pemain'} habis waktu, tidak jadi.`);
		return true;
	}
	kickTally(state);
	return state.kickVote !== k;
}

/** yang berhak atas sewa yang sedang menunggu dibayar (null kalau sewa batal) */
function rentCreditor(state, payer) {
	const r = state.pendingRent;
	const own = r && state.tiles[r.tile];
	if (!own || own.mortgaged) return null;
	const owner = playerById(state, own.owner);
	return owner && !owner.bankrupt && owner.id !== payer.id ? owner : null;
}

function payRent(state, p) {
	const r = state.pendingRent;
	if (state.phase !== 'rent' || !r) fail('Tidak ada sewa yang harus dibayar.');
	const tile = TILES[r.tile];
	const owner = rentCreditor(state, p);
	if (!owner) {
		state.pendingRent = null;
		log(state, `Sewa ${tile.name} batal (pemilik berubah/digadai).`);
		return afterResolve(state);
	}
	if (p.money < r.amount)
		fail(`Uang kurang ${formatRp(r.amount - p.money)}. Jual rumah, gadai/jual aset, jual saham, atau menyerah.`);
	state.pendingRent = null;
	if (owner.inJail) {
		pay(state, p, r.amount);
		log(state, `${owner.name} sedang di Ruang Sidang — sewa ${tile.name} ${formatRp(r.amount)} dari ${p.name} disita ke Kas Negara.`);
	} else {
		pay(state, p, r.amount, owner.id);
		log(state, `${p.name} bayar sewa ${formatRp(r.amount)} ke ${owner.name} di ${tile.name}.`);
	}
	afterResolve(state);
}

/**
 * Menyerah: kalau ada tagihan/utang, aset dijual otomatis (lihat surrenderPlan) untuk melunasinya.
 * Sisa > 0 = lanjut main dengan uang sisa; sisa <= 0 (atau tanpa utang) = bangkrut seperti biasa.
 */
function surrender(state, p) {
	const plan = surrenderPlan(state, p);
	if (plan.outcome !== 'lanjut') return goBankrupt(state, p);
	const proceeds = plan.properties + plan.buildings + plan.stocks;
	cleanMarketFor(state, p.id);
	for (const [i, t] of Object.entries(state.tiles)) if (t.owner === p.id) delete state.tiles[i];
	p.stocks = {};
	p.money += proceeds;
	const creditor = plan.creditorId ? playerById(state, plan.creditorId) : null;
	if (plan.rent > 0) {
		const r = state.pendingRent;
		state.pendingRent = null;
		p.money -= plan.rent;
		if (creditor && !creditor.inJail) creditor.money += plan.rent;
		else state.kasNegara += plan.rent;
		log(state, `${p.name} bayar sewa ${formatRp(plan.rent)} di ${TILES[r.tile].name}${creditor ? ` ke ${creditor.name}` : ''}.`);
	}
	log(
		state,
		`🏳️ ${p.name} menyerah: semua aset dijual otomatis (${formatRp(proceeds)}). Sisa saldo ${formatRp(p.money)}, lanjut main tanpa aset.`
	);
	if (state.phase === 'rent') afterResolve(state);
}

function goBankrupt(state, p) {
	p.bankrupt = true;
	const wasCurrent = current(state).id === p.id;
	// menyerah saat ditagih sewa: semua aset sisa jatuh ke pemilik yang menagih, bukan ke bank
	const creditor = wasCurrent && state.phase === 'rent' ? rentCreditor(state, p) : null;
	cleanMarketFor(state, p.id);
	if (creditor) {
		let n = 0;
		for (const t of Object.values(state.tiles)) {
			if (t.owner !== p.id) continue;
			t.owner = creditor.id;
			n += 1;
		}
		if (p.money > 0) creditor.money += p.money;
		p.money = 0;
		log(state, `💸 ${p.name} menyerah! ${n} asetnya jadi milik ${creditor.name}.`);
	} else {
		for (const [i, t] of Object.entries(state.tiles)) if (t.owner === p.id) delete state.tiles[i];
		log(state, `💸 ${p.name} bangkrut! Semua asetnya disita bank.`);
	}
	p.stocks = {};
	p.jailFree = 0;
	if (state.pendingRent && !state.tiles[state.pendingRent.tile] && !wasCurrent) {
		state.pendingRent = null;
		if (state.phase === 'rent') afterResolve(state);
	}
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
	if (own.level >= maxLevelOf(tile))
		fail(canSawit(tile) ? 'Sudah Kebun Sawit, mentok!' : `Sudah ${HOUSE_LEVELS[own.level].name}, mentok! Kebun Sawit hanya di Sumatra, Kalimantan, Sulawesi & Papua.`);
	// merata: abaikan kota yang sudah mentok di batas levelnya (mis. kota non-sawit di level OKB)
	const open = groupTiles(tile.group).filter((t) => state.tiles[t.i].level < maxLevelOf(t));
	if (open.some((t) => state.tiles[t.i].level < own.level))
		fail('Bangun merata dulu di kota lain dalam grup ini.');
	const cost = buildCost(GROUPS[tile.group].houseCost, own.level + 1);
	if (p.money < cost) fail(`Uang kurang, butuh ${formatRp(cost)}.`);
	p.money -= cost;
	own.level += 1;
	for (const t of groupTiles(tile.group)) dropListing(state, t.i);
	log(state, `${p.name} bangun ${HOUSE_LEVELS[own.level].name} di ${tile.name} (${formatRp(cost)}).`);
}

function sell(state, userId, tileIdx) {
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	if (tile.type !== 'property' || own.level === 0) fail('Tidak ada rumah untuk dijual.');
	const group = groupTiles(tile.group).map((t) => state.tiles[t.i]);
	if (own.level < Math.max(...group.map((t) => t.level)))
		fail('Jual merata dulu dari kota yang rumahnya lebih tinggi.');
	const refund = buildCost(GROUPS[tile.group].houseCost, own.level) / 2;
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
	dropListing(state, tileIdx);
	if (state.phase === 'rent' && state.pendingRent?.tile === tileIdx) {
		state.pendingRent = null;
		afterResolve(state);
	}
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

// ---------- saham ----------
// state.stocks[sym] = { price, prev, history[] }; player.stocks[sym] = { qty, cost }

function initStocks() {
	return Object.fromEntries(STOCKS.map((s) => [s.sym, { price: s.base, prev: s.base, history: [s.base], candles: [] }]));
}

const stocksOf = (state) => (state.stocks ??= initStocks());


/** random walk tiap giliran, ditarik pelan ke harga dasar */
function tickStocks(state, rng = Math.random) {
	const book = stocksOf(state);
	for (const def of STOCKS) {
		const s = (book[def.sym] ??= { price: def.base, prev: def.base, history: [def.base] });
		const z = (rng() + rng() + rng() - 1.5) * 2; // ~N(0,1), maks +-3
		const pull = 0.04 * Math.log(def.base / s.price);
		const pct = Math.max(-0.25, Math.min(0.25, def.vol * z + pull));
		const next = Math.max(Math.ceil(def.base * 0.2), Math.min(def.base * 5, Math.round(s.price * (1 + pct))));
		const wick = () => 1 + rng() * def.vol * 0.7;
		const candle = {
			o: s.price,
			h: Math.max(s.price, next, Math.round(Math.max(s.price, next) * wick())),
			l: Math.max(1, Math.min(s.price, next, Math.round(Math.min(s.price, next) / wick()))),
			c: next
		};
		s.candles = [...candlesOf(s), candle].slice(-STOCK_HISTORY);
		s.prev = s.price;
		s.price = next;
		s.history = [...s.history, next].slice(-STOCK_HISTORY);
		const move = (next - s.prev) / s.prev;
		if (Math.abs(move) >= 0.08)
			log(state, `${move > 0 ? '📈' : '📉'} ${def.sym} ${move > 0 ? 'melonjak' : 'anjlok'} ${Math.abs(Math.round(move * 100))}% jadi ${formatRp(next)}/lot.`);
	}
}

function parseQty(v) {
	const n = Math.floor(Number(v));
	if (!Number.isFinite(n) || n < 1 || n > 10000) fail('Jumlah lot harus bilangan bulat 1 - 10.000.');
	return n;
}

function stockDef(sym) {
	const def = STOCKS.find((s) => s.sym === sym);
	if (!def) fail('Saham tidak dikenal.');
	return def;
}

function stockBuy(state, userId, sym, qty) {
	const p = requireActive(state, userId);
	const def = stockDef(sym);
	const n = parseQty(qty);
	const price = stocksOf(state)[def.sym].price;
	const total = price * n;
	if (p.money < total) fail(`Uang kurang, butuh ${formatRp(total)}.`);
	p.money -= total;
	p.stocks ??= {};
	const h = (p.stocks[def.sym] ??= { qty: 0, cost: 0 });
	h.qty += n;
	h.cost += total;
	log(state, `📊 ${p.name} beli ${n} lot ${def.sym} @ ${formatRp(price)} (${formatRp(total)}).`);
}

function stockSell(state, userId, sym, qty) {
	const p = requireActive(state, userId);
	const def = stockDef(sym);
	const n = parseQty(qty);
	const h = p.stocks?.[def.sym];
	if (!h || h.qty < n) fail(`Kamu hanya punya ${h?.qty ?? 0} lot ${def.sym}.`);
	const price = stocksOf(state)[def.sym].price;
	const total = price * n;
	const costPart = Math.round((h.cost * n) / h.qty);
	h.qty -= n;
	h.cost -= costPart;
	if (h.qty === 0) delete p.stocks[def.sym];
	p.money += total;
	const gain = total - costPart;
	log(state, `📊 ${p.name} jual ${n} lot ${def.sym} @ ${formatRp(price)} (${gain >= 0 ? 'untung' : 'rugi'} ${formatRp(Math.abs(gain))}).`);
}

// ---------- marketplace ----------
// state.market[tileIdx] = { seller, price, offers: { [buyerId]: harga } }

const MARKET_MAX_PRICE = 100000;

/**
 * Visual judol slot: tiga gulungan yang konsisten dengan hasil acak.
 * >= +90% jackpot 7-7-7, +50..89% tiga sama, +1..49% dua sama, 0% campur,
 * -1..-49% ada 💀, -50..-89% dua 💀, <= -90% tiga 💀.
 */
function judolReels(pct, rng) {
	const pick = (arr) => arr[Math.floor(rng() * arr.length)];
	const fruit = ['💎', '🍒', '🍋', '🔔'];
	const shuffle3 = (r) => shuffle(r, rng);
	if (pct >= 90) return ['7️⃣', '7️⃣', '7️⃣'];
	if (pct >= 50) {
		const f = pick(fruit);
		return [f, f, f];
	}
	if (pct >= 1) {
		const f = pick(fruit);
		return shuffle3([f, f, pick(fruit.filter((x) => x !== f))]);
	}
	if (pct === 0) return shuffle3(['🍒', '🍋', '🔔']);
	if (pct <= -90) return ['💀', '💀', '💀'];
	if (pct <= -50) return shuffle3(['💀', '💀', pick(fruit)]);
	const [x, y] = shuffle3([...fruit]).slice(0, 2);
	return shuffle3(['💀', x, y]);
}

/** Judol: taruhan acak, hasil -100% sampai +100% dari taruhan (rata-rata impas) */
function judol(state, userId, amount, rng) {
	const p = requireActive(state, userId);
	const bet = Math.floor(Number(amount));
	if (!Number.isFinite(bet) || bet < 1) fail('Taruhan minimal Rp 1 jt.');
	if (bet > p.money) fail(`Saldo kurang, taruhan maksimal ${formatRp(Math.max(0, p.money))}.`);
	const pct = Math.round((rng() * 2 - 1) * 100);
	const delta = Math.round((bet * pct) / 100);
	p.money += delta;
	state.seq += 1;
	state.lastJudol = { seq: state.seq, playerId: p.id, playerName: p.name, bet, pct, delta, reels: judolReels(pct, rng) };
	log(
		state,
		`🎰 ${p.name} main judol ${formatRp(bet)}: ${delta >= 0 ? 'menang' : 'kalah'} ${formatRp(Math.abs(delta))} (${pct > 0 ? '+' : ''}${pct}%).`
	);
}

const cardKey = (id) => `card:${id}`;
const listingName = (key) => (isCardKey(key) ? 'Kartu Pemutihan' : TILES[key].name);
const market = (state) => (state.market ??= {});
const dropListing = (state, tileIdx) => {
	if (state.market) delete state.market[tileIdx];
};

function parsePrice(v) {
	const n = Math.round(Number(v));
	if (!Number.isFinite(n) || n < 1 || n > MARKET_MAX_PRICE) fail(`Harga harus 1 - ${MARKET_MAX_PRICE.toLocaleString('id-ID')} jt.`);
	return n;
}

function requireActive(state, userId) {
	if (state.status !== 'playing') fail('Game belum berjalan.');
	const p = playerById(state, userId);
	if (!p || p.bankrupt) fail('Kamu bukan pemain aktif.');
	return p;
}

/** @returns {{ l: any, own: any, tile: any }} */
function requireListing(state, tileIdx) {
	const l = market(state)[tileIdx];
	if (!l) fail('Aset ini tidak dijual.');
	if (isCardKey(tileIdx)) {
		const seller = playerById(state, l.seller);
		if (!seller || seller.bankrupt || seller.jailFree < 1) {
			dropListing(state, tileIdx);
			fail('Penjual sudah tidak punya kartu ini.');
		}
		return { l, own: null, tile: null };
	}
	const own = state.tiles[tileIdx];
	if (!own || own.owner !== l.seller) {
		dropListing(state, tileIdx);
		fail('Penjual sudah tidak memiliki aset ini.');
	}
	return { l, own, tile: TILES[tileIdx] };
}

function sellable(state, tile, own) {
	if (own.mortgaged) fail('Tebus dulu aset yang digadai sebelum dijual.');
	if (tile.type === 'property' && groupTiles(tile.group).some((t) => (state.tiles[t.i]?.level ?? 0) > 0))
		fail('Jual dulu semua rumah di grup ini.');
}

/** pasang listing baru atau ubah harga listing yang ada */
/** kabar Pasar untuk client: notifikasi, titik di tab, dan animasi kartu pindah */
function mkEvent(state, kind, tileIdx, actor, target, price, extra = {}) {
	state.mkEvent = { seq: (state.mkEvent?.seq ?? 0) + 1, kind, tile: isCardKey(tileIdx) ? tileIdx : +tileIdx, actor, target, price, ...extra };
}

function listAsset(state, userId, tileIdx, price) {
	if (tileIdx === 'card' || isCardKey(tileIdx)) {
		const p = requireActive(state, userId);
		if (p.jailFree < 1) fail('Kamu tidak punya kartu Pemutihan.');
		const key = cardKey(p.id);
		const m = market(state);
		const edit = !!m[key];
		const amount = parsePrice(price);
		m[key] = { seller: p.id, price: amount, offers: m[key]?.offers ?? {} };
		mkEvent(state, edit ? 'reprice' : 'list', key, p.id, null, amount);
		log(state, `🏷️ ${p.name} ${edit ? 'ubah harga' : 'jual'} Kartu Pemutihan di Pasar: ${formatRp(amount)}.`);
		return;
	}
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	sellable(state, tile, own);
	const m = market(state);
	const edit = !!m[tileIdx];
	const amount = parsePrice(price);
	m[tileIdx] = { seller: p.id, price: amount, offers: m[tileIdx]?.offers ?? {} };
	mkEvent(state, edit ? 'reprice' : 'list', tileIdx, p.id, null, amount);
	log(state, `🏷️ ${p.name} ${edit ? 'ubah harga' : 'jual'} ${tile.name} di Pasar: ${formatRp(amount)}.`);
}

function unlistAsset(state, userId, tileIdx) {
	if (tileIdx === 'card' || isCardKey(tileIdx)) {
		const p = requireActive(state, userId);
		if (!market(state)[cardKey(p.id)]) fail('Kartu ini tidak dijual.');
		dropListing(state, cardKey(p.id));
		log(state, `${p.name} tarik Kartu Pemutihan dari Pasar.`);
		return;
	}
	const { p, tile } = requireOwner(state, userId, tileIdx);
	if (!market(state)[tileIdx]) fail('Aset ini tidak dijual.');
	dropListing(state, tileIdx);
	log(state, `${p.name} tarik ${tile.name} dari Pasar.`);
}

function completeSale(state, tileIdx, buyer, price, how) {
	if (isCardKey(tileIdx)) {
		const { l } = requireListing(state, tileIdx);
		const seller = playerById(state, l.seller);
		if (buyer.id === seller.id) fail('Tidak bisa beli kartumu sendiri.');
		if (buyer.money < price) fail(`Uang kurang, butuh ${formatRp(price)}.`);
		buyer.money -= price;
		seller.money += price;
		seller.jailFree -= 1;
		buyer.jailFree += 1;
		dropListing(state, tileIdx);
		mkEvent(state, 'sold', tileIdx, buyer.id, seller.id, price, { from: seller.id, to: buyer.id });
		log(state, `🤝 ${buyer.name} ${how} Kartu Pemutihan dari ${seller.name} seharga ${formatRp(price)}.`);
		return;
	}
	const { l, own, tile } = requireListing(state, tileIdx);
	const seller = playerById(state, l.seller);
	try {
		sellable(state, tile, own);
	} catch (e) {
		dropListing(state, tileIdx);
		throw e;
	}
	if (buyer.id === seller.id) fail('Tidak bisa beli asetmu sendiri.');
	if (buyer.money < price) fail(`Uang kurang, butuh ${formatRp(price)}.`);
	buyer.money -= price;
	seller.money += price;
	own.owner = buyer.id;
	dropListing(state, tileIdx);
	mkEvent(state, 'sold', tileIdx, buyer.id, seller.id, price, { from: seller.id, to: buyer.id });
	log(state, `🤝 ${buyer.name} ${how} ${tile.name} dari ${seller.name} seharga ${formatRp(price)}.`);
}

function marketBuy(state, userId, tileIdx) {
	const buyer = requireActive(state, userId);
	const { l } = requireListing(state, tileIdx);
	completeSale(state, tileIdx, buyer, l.price, 'beli');
}

function marketOffer(state, userId, tileIdx, price) {
	const buyer = requireActive(state, userId);
	const { l } = requireListing(state, tileIdx);
	if (l.seller === buyer.id) fail('Tidak bisa menawar asetmu sendiri.');
	const amount = parsePrice(price);
	l.offers[buyer.id] = amount;
	mkEvent(state, 'offer', tileIdx, buyer.id, l.seller, amount);
	log(state, `💬 ${buyer.name} menawar ${listingName(tileIdx)} ${formatRp(amount)} (harga jual ${formatRp(l.price)}).`);
}

function marketCancelOffer(state, userId, tileIdx) {
	requireActive(state, userId);
	const l = market(state)[tileIdx];
	if (!l || !(userId in l.offers)) fail('Tidak ada tawaranmu.');
	delete l.offers[userId];
}

function requireSeller(state, userId, key) {
	if (!isCardKey(key)) return requireOwner(state, userId, key);
	if (key !== cardKey(userId)) fail('Kartu ini bukan milikmu.');
	return requireActive(state, userId);
}

function marketAccept(state, userId, tileIdx, buyerId) {
	requireSeller(state, userId, tileIdx);
	const { l } = requireListing(state, tileIdx);
	const price = l.offers[buyerId];
	if (price == null) fail('Tawaran sudah tidak ada.');
	const buyer = playerById(state, buyerId);
	if (!buyer || buyer.bankrupt) {
		delete l.offers[buyerId];
		fail('Penawar sudah tidak aktif.');
	}
	completeSale(state, tileIdx, buyer, price, 'beli (nego)');
}

function marketReject(state, userId, tileIdx, buyerId) {
	requireSeller(state, userId, tileIdx);
	const l = market(state)[tileIdx];
	if (!l || !(buyerId in l.offers)) fail('Tawaran sudah tidak ada.');
	const buyer = playerById(state, buyerId);
	delete l.offers[buyerId];
	mkEvent(state, 'reject', tileIdx, userId, buyerId, 0);
	log(state, `${playerById(state, userId).name} tolak tawaran ${buyer?.name ?? 'pemain'} untuk ${listingName(tileIdx)}.`);
}

function cleanMarketFor(state, playerId) {
	for (const [i, l] of Object.entries(market(state))) {
		if (l.seller === playerId) delete state.market[i];
		else delete l.offers[playerId];
	}
}

// ---------- dispatcher ----------

/**
 * @param {any} state
 * @param {string} userId
 * @param {{type:string, tile?:number}} action
 * @param {() => number} rng
 */
export function applyAction(state, userId, action, rng = Math.random) {
	try {
		return dispatch(state, userId, action, rng);
	} finally {
		checkWinner(state);
	}
}

function dispatch(state, userId, action, rng) {
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

		case 'kickStart': {
			const p = requireActive(state, userId);
			const target = playerById(state, action.target);
			if (!target || target.bankrupt) fail('Pemain itu sudah tidak aktif.');
			if (target.id === p.id) fail('Tidak bisa voting untuk dirimu sendiri.');
			if (alive(state).length < 3) fail('Voting kick butuh minimal 3 pemain aktif.');
			if (state.kickVote) fail('Masih ada voting yang berjalan.');
			if (Date.now() < (state.kickCoolUntil ?? 0)) fail('Tunggu sebentar sebelum voting lagi.');
			state.kickVote = { target: target.id, by: p.id, votes: { [p.id]: true }, deadline: Date.now() + KICK_TIMEOUT_MS };
			log(state, `🗳️ ${p.name} mengajukan voting untuk mengeluarkan ${target.name} (butuh ${kickNeeded(state)} setuju).`);
			return kickTally(state);
		}

		case 'kickVote': {
			const p = requireActive(state, userId);
			const k = state.kickVote;
			if (!k) fail('Tidak ada voting.');
			if (p.id === k.target) fail('Kamu tidak bisa ikut voting untuk dirimu sendiri.');
			k.votes[p.id] = !!action.agree;
			return kickTally(state);
		}

		case 'kickCancel': {
			const k = state.kickVote;
			if (!k || k.by !== userId) fail('Hanya pengaju yang bisa membatalkan.');
			state.kickVote = null;
			log(state, `🗳️ Voting dibatalkan oleh pengaju.`);
			return;
		}

		case 'payRent':
			return payRent(state, requireTurn(state, userId));

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
			log(state, `${p.name} bayar denda tilang ${formatRp(JAIL_FINE)} ke Kas Negara, langsung bebas.`);
			return;
		}

		case 'useJailFree': {
			const p = requireTurn(state, userId);
			if (!p.inJail || state.phase !== 'roll') fail('Kamu tidak di Ruang Sidang.');
			if (p.jailFree < 1) fail('Kamu tidak punya kartu Pemutihan.');
			p.jailFree -= 1;
			if (p.jailFree < 1) dropListing(state, cardKey(p.id));
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

		case 'stockBuy':
			return stockBuy(state, userId, action.sym, action.qty);
		case 'stockSell':
			return stockSell(state, userId, action.sym, action.qty);

		case 'judol':
			return judol(state, userId, action.amount, rng);

		case 'mkList':
			return listAsset(state, userId, action.tile, action.price);
		case 'mkUnlist':
			return unlistAsset(state, userId, action.tile);
		case 'mkBuy':
			return marketBuy(state, userId, action.tile);
		case 'mkOffer':
			return marketOffer(state, userId, action.tile, action.price);
		case 'mkCancelOffer':
			return marketCancelOffer(state, userId, action.tile);
		case 'mkAccept':
			return marketAccept(state, userId, action.tile, action.buyer);
		case 'mkReject':
			return marketReject(state, userId, action.tile, action.buyer);

		case 'bankrupt': {
			if (state.status !== 'playing') fail('Game belum berjalan.');
			const p = playerById(state, userId);
			if (!p || p.bankrupt) fail('Kamu bukan pemain aktif.');
			return surrender(state, p);
		}

		case 'autoPlay': {
			if (state.hostId !== userId) fail('Hanya host yang bisa mengaktifkan auto-play AI.');
			state.autoPlay = !!action.on;
			log(state, state.autoPlay ? '🤖 Host mengaktifkan auto-play AI.' : '🤖 Auto-play AI dimatikan host.');
			return;
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
	if (state.phase === 'rent') {
		try {
			payRent(state, p);
		} catch (e) {
			if (!(e instanceof GameError)) throw e;
		}
		if (state.phase === 'rent') return goBankrupt(state, p);
	}
	if (p.money < 0) return goBankrupt(state, p);
	nextTurn(state);
}

/** State untuk dikirim ke client (tanpa urutan deck). */
export function publicState(state) {
	const { decks, ...rest } = state;
	return { ...rest, deckSizes: { musibah: decks.musibah.length, takdir: decks.takdir.length } };
}
