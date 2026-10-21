// Mesin aturan "Jadi WNI" — server-authoritative, mutasi state secara langsung.
import {
	isCardKey,
	isUsahaKey,
	usahaKey,
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
	pickStockNews,
	usahaById,
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
	WIN_NETWORTH,
	adCost,
	adCopy,
	AD_SECONDS,
	AD_SKIP_COST
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

// ---------- merger / group ----------
// Dua pemain bisa merger jadi satu group (teamId sama): uang & aset jadi bersama.

/** partner se-group dari p (atau null kalau solo) */
function teammateOf(state, p) {
	if (!p?.teamId) return null;
	return state.players.find((x) => x.id !== p.id && x.teamId === p.teamId) ?? null;
}
/** semua anggota group p (termasuk p); array berisi 1 kalau solo */
function teamMembers(state, p) {
	if (!p?.teamId) return [p];
	return state.players.filter((x) => x.teamId === p.teamId);
}
/** apakah idA & idB satu group (id berbeda, teamId sama & terisi) */
function sameTeam(state, idA, idB) {
	if (!idA || !idB || idA === idB) return false;
	const a = playerById(state, idA);
	const b = playerById(state, idB);
	return !!a?.teamId && a.teamId === b?.teamId;
}
/** id se-group dengan ownerId (termasuk ownerId) — dipakai untuk kepemilikan bersama */
function teamOwnerIds(state, ownerId) {
	const o = playerById(state, ownerId);
	if (!o?.teamId) return new Set([ownerId]);
	return new Set(state.players.filter((x) => x.teamId === o.teamId).map((x) => x.id));
}

// Kas bersama disimpan di satu objek (holder = anggota dengan id terkecil) agar tak
// dobel-hitung; saldo anggota lain di-mirror lewat syncTeams untuk tampilan client.
function holder(state, p) {
	const m = teammateOf(state, p);
	return m && m.id < p.id ? m : p;
}
const money = (state, p) => holder(state, p).money;
const addMoney = (state, p, delta) => {
	holder(state, p).money += delta;
};
/** cerminkan kas bersama ke kedua kartu anggota group (dipanggil sebelum broadcast) */
function syncTeams(state) {
	for (const p of state.players) {
		const h = holder(state, p);
		if (h !== p) p.money = h.money;
	}
}

export function createGame(code, host, opts = {}) {
	const state = {
		code,
		hostId: host.id,
		status: 'lobby',
		createdAt: Date.now(),
		knockout: false, // fitur Knock Out dimatikan
		koNextAt: null,
		koWarnUntil: null,
		paused: false,
		pausedAt: null,
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
		ad: null,
		kasNegara: 0,
		bandarJudod: 0,
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
		usaha: null,
		teamId: null,
		bankrupt: false
	});
	log(state, `${user.name} masuk room.`);
}

/** Hidupkan kembali pemain yang sudah rungkat: reset ke kondisi awal, modal START_MONEY, taruh di GAJIAN. */
function reviveBankrupt(state, p) {
	p.bankrupt = false;
	p.money = START_MONEY;
	p.pos = 0;
	p.inJail = false;
	p.jailTurns = 0;
	p.jailFree = 0;
	p.stocks = {};
	p.usaha = null;
	p.teamId = null; // kembali main sebagai pemain solo
	p.rejoined = true; // jatah main lagi hanya sekali
}

export function removePlayer(state, userId) {
	if (state.status !== 'lobby') fail('Tidak bisa keluar saat game berjalan — gunakan Rungkat.');
	const idx = state.players.findIndex((p) => p.id === userId);
	if (idx < 0) return;
	const [p] = state.players.splice(idx, 1);
	log(state, `${p.name} keluar room.`);
	// kalau dia bagian group, bubarkan: partner kembali solo
	if (p.teamId) for (const x of state.players) if (x.teamId === p.teamId) x.teamId = null;
	// batalkan ajakan merger yang melibatkan dia
	if (state.mergeOffer && (state.mergeOffer.from === p.id || state.mergeOffer.to === p.id)) state.mergeOffer = null;
	// bot tidak ditinggal sendirian di room tanpa manusia, dan tidak jadi host
	if (state.players.every((x) => x.bot)) state.players.length = 0;
	if (state.hostId === userId && state.players.length) {
		const next = state.players.find((x) => !x.bot) ?? state.players[0];
		state.hostId = next.id;
		log(state, `${next.name} sekarang jadi host.`);
	}
}

/** Pemain baru minta gabung — atau pemain rungkat minta main lagi — saat game berjalan (perlu persetujuan host). */
export function requestJoin(state, user) {
	if (state.status !== 'playing') fail('Permintaan gabung hanya saat game berjalan.');
	const existing = playerById(state, user.id);
	if (existing && !existing.bankrupt) fail('Kamu sudah jadi pemain.');
	if (existing?.bankrupt && existing.rejoined) fail('Jatah main lagi sudah dipakai (hanya boleh sekali).');
	// pemain baru butuh slot kosong; pemain rungkat sudah punya slot sendiri
	if (!existing && state.players.length >= MAX_PLAYERS) fail(`Room penuh (maks ${MAX_PLAYERS} pemain).`);
	state.joinRequests ??= [];
	if (state.joinRequests.some((r) => r.id === user.id)) return; // sudah antre
	state.joinRequests.push({ id: user.id, name: user.name, avatar: user.avatar ?? null, at: Date.now() });
	log(state, existing ? `✋ ${user.name} (rungkat) minta main lagi.` : `✋ ${user.name} minta gabung di tengah permainan.`);
}

function dropJoinRequest(state, userId) {
	const reqs = state.joinRequests ?? [];
	const idx = reqs.findIndex((r) => r.id === userId);
	if (idx < 0) return null;
	return reqs.splice(idx, 1)[0];
}

/** Host menyetujui: pemain masuk di tengah permainan dengan modal awal, taruh di GAJIAN. */
export function approveJoin(state, hostId, userId) {
	if (state.hostId !== hostId) fail('Hanya host yang bisa menyetujui pemain baru.');
	if (state.status !== 'playing') fail('Game belum berjalan.');
	const req = dropJoinRequest(state, userId);
	if (!req) fail('Permintaan gabung tidak ada.');
	const existing = playerById(state, req.id);
	if (existing) {
		// pemain rungkat main lagi: hidupkan kembali di slot yang sama (hanya sekali)
		if (!existing.bankrupt) return;
		if (existing.rejoined) fail('Pemain itu sudah pernah main lagi (jatah sekali sudah dipakai).');
		reviveBankrupt(state, existing);
		log(state, `✅ ${req.name} main lagi (disetujui host), dapat modal ${formatRp(START_MONEY)}.`);
		return;
	}
	if (state.players.length >= MAX_PLAYERS) fail(`Room penuh (maks ${MAX_PLAYERS} pemain).`);
	const usedTokens = new Set(state.players.map((p) => p.token));
	const usedColors = new Set(state.players.map((p) => p.color));
	state.players.push({
		id: req.id,
		name: req.name,
		avatar: req.avatar ?? null,
		token: (TOKENS.find((t) => !usedTokens.has(t.id)) ?? TOKENS[0]).id,
		color: PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0],
		money: START_MONEY,
		pos: 0,
		inJail: false,
		jailTurns: 0,
		jailFree: 0,
		stocks: {},
		usaha: null,
		teamId: null,
		bankrupt: false
	});
	log(state, `✅ ${req.name} bergabung di tengah permainan (disetujui host), dapat modal ${formatRp(START_MONEY)}.`);
}

export function rejectJoin(state, hostId, userId) {
	if (state.hostId !== hostId) fail('Hanya host yang bisa menolak.');
	const req = dropJoinRequest(state, userId);
	if (req) log(state, `🚫 Host menolak permintaan gabung ${req.name}.`);
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
	if (state.knockout) {
		state.koNextAt = Date.now() + KO_PERIOD_MS;
		state.koWarnUntil = null;
	}
	log(state, `Game dimulai! Urutan: ${state.players.map((p) => p.name).join(' → ')}.`);
	if (state.knockout) log(state, `☠️ Mode Knock Out aktif: tiap 20 menit pemain termiskin tereliminasi (ada 3 menit peringatan untuk jual aset).`);
	log(state, `Giliran ${current(state).name}.`);
}

// ---------- uang ----------

/** bayar ke pemain lain (toId) atau ke Kas Negara (toId = null) */
function pay(state, p, amount, toId = null) {
	if (amount <= 0) return;
	addMoney(state, p, -amount);
	if (toId) {
		const to = playerById(state, toId);
		addMoney(state, to, amount);
	} else {
		state.kasNegara += amount;
	}
}

// ---------- pergerakan ----------

function collectSalary(state, p) {
	const { sawit, bonus, amount } = salaryFor(state.tiles, p.id);
	addMoney(state, p, amount);
	p.laps = (p.laps ?? 0) + 1;
	log(
		state,
		`${p.name} lewat GAJIAN, terima ${formatRp(amount)}${sawit ? ` (bonus ${sawit} Kebun Sawit ${formatRp(bonus)})` : ''}.`
	);
	const u = usahaById(p.usaha);
	if (u?.income) {
		addMoney(state, p, u.income);
		log(state, `${u.emoji} ${p.name} dapat setoran usaha ${u.name} ${formatRp(u.income)}.`);
	}
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
	const ids = teamOwnerIds(state, ownerId);
	return groupTiles(group).every((t) => ids.has(state.tiles[t.i]?.owner));
}

function countOwned(state, ownerId, type) {
	const ids = teamOwnerIds(state, ownerId);
	return TILES.filter((t) => t.type === type && ids.has(state.tiles[t.i]?.owner)).length;
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
			if (sameTeam(state, p.id, own.owner)) {
				log(state, `${p.name} mampir ke ${tile.name} milik se-group (${playerById(state, own.owner).name}) — bebas sewa.`);
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
				addMoney(state, p, state.kasNegara);
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

/** kartu berasset (req) hanya berlaku buat pemain yang punya asetnya */
function playerHasHouse(state, id) {
	return Object.entries(state.tiles).some(([i, t]) => t.owner === id && TILES[+i].type === 'property' && (t.level ?? 0) >= 1);
}
function playerHasSawit(state, id) {
	return Object.entries(state.tiles).some(([i, t]) => t.owner === id && TILES[+i].type === 'property' && t.level === SAWIT_LEVEL);
}
function cardApplies(state, p, card) {
	switch (card.req) {
		case 'house': return playerHasHouse(state, p.id);
		case 'sawit': return playerHasSawit(state, p.id);
		case 'usaha': return !!p.usaha;
		default: return true;
	}
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
	// ambil kartu pertama yang cocok buat pemain ini; kartu berasset dilewati kalau asetnya tak ada
	const pile = state.decks[deck];
	let pos = pile.findIndex((k) => cardApplies(state, p, CARDS[deck][k]));
	if (pos < 0) pos = 0;
	const idx = pile.splice(pos, 1)[0];
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

	if (fx.money > 0) addMoney(state, p, fx.money);
	if (fx.money < 0) pay(state, p, -fx.money);
	if (fx.usahaHit) {
		const u = usahaById(p.usaha);
		if (u) {
			const loss = u.musibahLoss;
			state.lastCard.text = `💼 ${u.musibah}! Rugi ${formatRp(loss)}.`;
			log(state, `💼 ${p.name}: ${u.musibah}, rugi ${formatRp(loss)}.`);
			pay(state, p, loss);
		} else {
			state.lastCard.text = '💼 Harusnya usahamu kena musibah — untung kamu belum buka usaha. Lolos!';
			log(state, `${p.name} belum punya usaha, lolos dari musibah usaha.`);
		}
	}
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
	if (money(state, p) < 0) fail('Lunasi utang dulu (jual rumah / gadai) sebelum lempar dadu.');
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
			const who = teamMembers(state, rich).map((m) => m.name).join(' & ');
			log(state, `🏆 ${who} tembus ${formatRp(WIN_NETWORTH)} dan jadi WNI paling sukses! Game selesai.`);
			return;
		}
	}
	if (state.status === 'playing' && left.length <= 1) {
		state.status = 'ended';
		state.winner = left[0]?.id ?? null;
		const who = left[0] ? teamMembers(state, left[0]).map((m) => m.name).join(' & ') : 'Tidak ada';
		log(state, `🏆 ${who} jadi WNI paling sukses! Game selesai.`);
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

// ---------- merger (ajak & setujui, hanya di lobby) ----------

export const MERGE_TIMEOUT_MS = 45_000;

function mergeInvite(state, userId, targetId) {
	if (state.status !== 'lobby') fail('Merger hanya bisa dibentuk di lobby sebelum game dimulai.');
	const p = playerById(state, userId);
	if (!p) fail('Kamu bukan pemain di room ini.');
	const target = playerById(state, targetId);
	if (!target) fail('Pemain tidak ada.');
	if (target.id === p.id) fail('Tidak bisa merger dengan diri sendiri.');
	if (p.teamId) fail('Kamu sudah punya group.');
	if (target.teamId) fail(`${target.name} sudah punya group.`);
	if (state.mergeOffer) fail('Masih ada ajakan merger yang berjalan.');
	state.mergeOffer = { from: p.id, fromName: p.name, to: target.id, toName: target.name, deadline: Date.now() + MERGE_TIMEOUT_MS };
	log(state, `🤝 ${p.name} mengajak ${target.name} merger jadi satu group.`);
}

function mergeAccept(state, userId) {
	const o = state.mergeOffer;
	if (!o) fail('Tidak ada ajakan merger.');
	if (o.to !== userId) fail('Ini bukan ajakan untukmu.');
	if (state.status !== 'lobby') {
		state.mergeOffer = null;
		fail('Merger hanya bisa dibentuk di lobby.');
	}
	const a = playerById(state, o.from);
	const b = playerById(state, o.to);
	state.mergeOffer = null;
	if (!a || !b) fail('Ajakan merger tidak berlaku lagi.');
	if (a.teamId || b.teamId) fail('Salah satu sudah punya group.');
	const teamId = `team:${a.id}`;
	a.teamId = teamId;
	b.teamId = teamId;
	// kas digabung jadi kas bersama (disimpan di holder, anggota lain di-mirror)
	const pool = a.money + b.money;
	const h = holder(state, a);
	h.money = pool;
	syncTeams(state);
	log(state, `🤝 ${a.name} & ${b.name} merger jadi satu group! Kas bersama ${formatRp(pool)}.`);
}

function mergeReject(state, userId) {
	const o = state.mergeOffer;
	if (!o) fail('Tidak ada ajakan merger.');
	if (o.to !== userId && o.from !== userId) fail('Kamu tidak terkait ajakan ini.');
	state.mergeOffer = null;
	log(state, o.to === userId ? `🙅 ${o.toName} menolak ajakan merger ${o.fromName}.` : `🙅 ${o.fromName} membatalkan ajakan merger.`);
}

/** dipanggil server tiap detik: ajakan merger kadaluarsa. true kalau state berubah. */
export function expireMerge(state, now = Date.now()) {
	const o = state.mergeOffer;
	if (!o) return false;
	// batalkan juga kalau salah satu sudah tidak aktif
	const a = playerById(state, o.from);
	const b = playerById(state, o.to);
	if (now >= o.deadline || !a || a.bankrupt || !b || b.bankrupt) {
		state.mergeOffer = null;
		if (now >= o.deadline) log(state, `🤝 Ajakan merger ${o.fromName} → ${o.toName} habis waktu.`);
		return true;
	}
	return false;
}

// ---------- iklan properti (Pasang Iklan) ----------

const AD_MS = AD_SECONDS * 1000;

/** Pasang iklan untuk properti milik sendiri: pemain lain terganggu ~20 detik. Biaya 25% harga -> Kas Negara. */
function placeAd(state, userId, tileIdx) {
	const p = requireActive(state, userId);
	if (state.ad) fail('Sudah ada iklan yang sedang tayang.');
	if (p.adTurn === state.turnCount) fail('Kamu sudah pasang iklan giliran ini.');
	const own = state.tiles[tileIdx];
	const tile = TILES[tileIdx];
	if (!tile || tile.type !== 'property') fail('Hanya properti yang bisa diiklankan.');
	if (!own || own.owner !== userId) fail('Kamu hanya bisa mengiklankan propertimu sendiri.');
	const cost = adCost(tile);
	if (money(state, p) < cost) fail(`Uang kurang, biaya iklan ${formatRp(cost)}.`);
	pay(state, p, cost); // -> Kas Negara
	p.adTurn = state.turnCount;
	state.seq += 1;
	state.ad = { by: userId, byName: p.name, tile: tileIdx, name: tile.name, text: adCopy(tile), cost, deadline: Date.now() + AD_MS, skipped: [] };
	log(state, `📺 ${p.name} pasang iklan ${tile.name} (${formatRp(cost)} ke Kas Negara). Pemain lain ketahan ${AD_SECONDS} detik!`);
}

/** Bayar Rp 25 jt (-> Kas Negara) untuk lepas dari iklan lebih cepat. */
function skipAd(state, userId) {
	const p = requireActive(state, userId);
	if (!state.ad) fail('Tidak ada iklan yang tayang.');
	if (userId === state.ad.by || state.ad.skipped.includes(userId)) return;
	if (money(state, p) < AD_SKIP_COST) fail(`Uang kurang untuk skip iklan (${formatRp(AD_SKIP_COST)}).`);
	pay(state, p, AD_SKIP_COST); // -> Kas Negara
	state.ad.skipped.push(userId);
	state.seq += 1;
	log(state, `📺 ${p.name} bayar ${formatRp(AD_SKIP_COST)} untuk skip iklan.`);
}

/** dipanggil server tiap detik: iklan habis waktu -> hilang. true kalau state berubah. */
export function expireAd(state, now = Date.now()) {
	if (!state.ad) return false;
	if (now >= state.ad.deadline) {
		state.ad = null;
		return true;
	}
	return false;
}

/** yang berhak atas sewa yang sedang menunggu dibayar (null kalau sewa batal) */
function rentCreditor(state, payer) {
	const r = state.pendingRent;
	const own = r && state.tiles[r.tile];
	if (!own || own.mortgaged) return null;
	const owner = playerById(state, own.owner);
	if (!owner || owner.bankrupt || owner.id === payer.id) return null;
	if (sameTeam(state, payer.id, owner.id)) return null; // se-group: tak saling bayar sewa
	return owner;
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
	if (money(state, p) < r.amount)
		fail(`Uang kurang ${formatRp(r.amount - money(state, p))}. Jual rumah, gadai/jual aset, jual saham, atau menyerah.`);
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
	// aset se-group dijual bersama; kas bersama dipakai menutup tagihan
	const members = teamMembers(state, p);
	const ids = new Set(members.map((m) => m.id));
	const grouped = members.length > 1;
	const proceeds = plan.properties + plan.buildings + plan.stocks;
	for (const m of members) cleanMarketFor(state, m.id);
	for (const [i, t] of Object.entries(state.tiles)) if (ids.has(t.owner)) delete state.tiles[i];
	for (const m of members) m.stocks = {};
	addMoney(state, p, proceeds);
	const creditor = plan.creditorId ? playerById(state, plan.creditorId) : null;
	if (plan.rent > 0) {
		const r = state.pendingRent;
		state.pendingRent = null;
		addMoney(state, p, -plan.rent);
		if (creditor && !creditor.inJail) addMoney(state, creditor, plan.rent);
		else state.kasNegara += plan.rent;
		log(state, `${p.name} bayar sewa ${formatRp(plan.rent)} di ${TILES[r.tile].name}${creditor ? ` ke ${creditor.name}` : ''}.`);
	}
	log(
		state,
		`🏳️ ${p.name}${grouped ? ' & group-nya' : ''} menyerah: semua aset dijual otomatis (${formatRp(proceeds)}). Sisa kas ${formatRp(money(state, p))}, lanjut main tanpa aset.`
	);
	if (state.phase === 'rent') afterResolve(state);
}

function goBankrupt(state, p) {
	// bangkrut sehidup-semati: seluruh anggota group ikut bangkrut
	const members = teamMembers(state, p);
	const ids = new Set(members.map((m) => m.id));
	const grouped = members.length > 1;
	const names = members.map((m) => m.name).join(' & ');
	const wasCurrent = ids.has(current(state).id);
	// menyerah saat ditagih sewa: semua aset sisa jatuh ke pemilik yang menagih, bukan ke bank
	const creditor = wasCurrent && state.phase === 'rent' ? rentCreditor(state, current(state)) : null;
	for (const m of members) {
		m.bankrupt = true;
		cleanMarketFor(state, m.id);
	}
	if (creditor && !ids.has(creditor.id)) {
		let n = 0;
		for (const t of Object.values(state.tiles)) {
			if (!ids.has(t.owner)) continue;
			t.owner = creditor.id;
			n += 1;
		}
		const cash = money(state, p);
		if (cash > 0) addMoney(state, creditor, cash);
		for (const m of members) m.money = 0;
		log(state, `💸 ${names} menyerah! ${n} aset${grouped ? ' group' : 'nya'} jadi milik ${creditor.name}.`);
	} else {
		for (const [i, t] of Object.entries(state.tiles)) if (ids.has(t.owner)) delete state.tiles[i];
		for (const m of members) m.money = 0;
		log(state, `💸 ${names} rungkat! Semua aset${grouped ? ' group' : 'nya'} disita bank.`);
	}
	for (const m of members) {
		m.stocks = {};
		m.jailFree = 0;
	}
	if (state.pendingRent && !state.tiles[state.pendingRent.tile] && !wasCurrent) {
		state.pendingRent = null;
		if (state.phase === 'rent') afterResolve(state);
	}
	checkWinner(state);
	if (state.status === 'playing' && wasCurrent) nextTurn(state);
}

// ---------- knock out (opsional) ----------

export const KO_PERIOD_MS = 20 * 60 * 1000; // tiap 20 menit
export const KO_WARN_MS = 3 * 60 * 1000; // peringatan 3 menit sebelum eliminasi

/** pemain hidup dengan kekayaan bersih terendah (tie-break: uang tunai lalu urutan) */
function koPoorest(state) {
	const alive = state.players.filter((p) => !p.bankrupt);
	if (!alive.length) return null;
	return alive
		.map((p, idx) => ({ p, idx, w: netWorth(state, p) }))
		.sort((a, b) => a.w - b.w || a.p.money - b.p.money || a.idx - b.idx)[0].p;
}

/**
 * Siklus knock out. Dipanggil tiap detik dari server.
 * - Saat waktunya tiba: buka peringatan 3 menit (pemain bisa jual/beli aset untuk ubah posisi).
 * - Setelah 3 menit: pemain termiskin saat itu tereliminasi.
 * @returns {boolean} true kalau state berubah (perlu broadcast)
 */
export function knockoutTick(state, now = Date.now()) {
	return false; // fitur Knock Out dimatikan
	// eslint-disable-next-line no-unreachable
	if (!state.knockout || state.status !== 'playing') return false;
	const aliveCount = state.players.filter((p) => !p.bankrupt).length;
	if (aliveCount <= 1) return false;
	// mulai peringatan
	if (!state.koWarnUntil && state.koNextAt && now >= state.koNextAt) {
		state.koWarnUntil = now + KO_WARN_MS;
		state.koNextAt = now + KO_PERIOD_MS;
		const poorest = koPoorest(state);
		state.seq += 1;
		log(state, `☠️ KNOCK OUT dalam 3 menit! Yang termiskin akan tereliminasi. Terancam sekarang: ${poorest ? poorest.name : '-'}. Jual/beli aset untuk selamat.`);
		return true;
	}
	// eksekusi eliminasi
	if (state.koWarnUntil && now >= state.koWarnUntil) {
		state.koWarnUntil = null;
		const victim = koPoorest(state);
		if (victim) {
			log(state, `☠️ KNOCK OUT! ${victim.name} tereliminasi sebagai yang termiskin.`);
			goBankrupt(state, victim);
		}
		return true;
	}
	return false;
}

// ---------- properti ----------

function requireOwner(state, userId, tileIdx) {
	if (state.status !== 'playing') fail('Game belum berjalan.');
	const p = playerById(state, userId);
	if (!p || p.bankrupt) fail('Kamu bukan pemain aktif.');
	const tile = TILES[tileIdx];
	if (!tile || !isOwnable(tile)) fail('Petak ini tidak bisa dimiliki.');
	const own = state.tiles[tileIdx];
	// aset se-group dianggap milik bersama: anggota group boleh kelola
	if (!own || (own.owner !== userId && !sameTeam(state, userId, own.owner))) fail(`${tile.name} bukan milikmu.`);
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
	if (money(state, p) < cost) fail(`Uang kurang, butuh ${formatRp(cost)}.`);
	addMoney(state, p, -cost);
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
	addMoney(state, p, refund);
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
	addMoney(state, p, tile.price / 2);
	log(state, `${p.name} gadai ${tile.name} ke Pegadaian, terima ${formatRp(tile.price / 2)}.`);
}

export const redeemCost = (tile) => Math.ceil((tile.price / 2) * 1.1);

function unmortgage(state, userId, tileIdx) {
	const { p, tile, own } = requireOwner(state, userId, tileIdx);
	if (!own.mortgaged) fail('Tidak sedang digadai.');
	const cost = redeemCost(tile);
	if (money(state, p) < cost) fail(`Uang kurang, butuh ${formatRp(cost)}.`);
	addMoney(state, p, -cost);
	own.mortgaged = false;
	log(state, `${p.name} tebus ${tile.name} dari Pegadaian (${formatRp(cost)}).`);
}

// ---------- saham ----------
// state.stocks[sym] = { price, prev, history[] }; player.stocks[sym] = { qty, cost }

function initStocks() {
	return Object.fromEntries(STOCKS.map((s) => [s.sym, { price: s.base, prev: s.base, history: [s.base], candles: [] }]));
}

const stocksOf = (state) => (state.stocks ??= initStocks());


// ambang "turun drastis": kalau langkah acak <= ini, tunda sejenak & keluarkan berita dulu
const DROP_THRESHOLD = -0.11;

/** simpan berita saham untuk ticker (dibaca client) */
function pushStockNews(state, sym, text) {
	state.newsSeq = (state.newsSeq ?? 0) + 1;
	state.stockNews = [...(state.stockNews ?? []), { id: state.newsSeq, sym, text, t: Date.now() }].slice(-6);
	log(state, `📰 ${text}.`);
}

/** random walk tiap giliran, ditarik pelan ke harga dasar */
function tickStocks(state, rng = Math.random) {
	const book = stocksOf(state);
	for (const def of STOCKS) {
		const s = (book[def.sym] ??= { price: def.base, prev: def.base, history: [def.base] });
		let pct;
		if (s.shock != null) {
			// penurunan yang sudah diumumkan beritanya giliran lalu -> eksekusi sekarang
			pct = s.shock;
			s.shock = null;
		} else {
			const z = (rng() + rng() + rng() - 1.5) * 2; // ~N(0,1), maks +-3
			const pull = 0.04 * Math.log(def.base / s.price);
			pct = Math.max(-0.25, Math.min(0.25, def.vol * z + pull));
			// akan turun drastis? tahan dulu: keluarkan berita relevan & beri "euforia" tipis, drop giliran depan
			if (pct <= DROP_THRESHOLD) {
				s.shock = pct;
				pct = 0.01 + rng() * 0.03; // pump kecil dulu
				pushStockNews(state, def.sym, pickStockNews(def.sym, rng));
			}
		}
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

function buildUsaha(state, userId, id) {
	const p = requireActive(state, userId);
	if (p.usaha) fail('Kamu sudah punya usaha — cuma boleh satu.');
	const u = usahaById(id);
	if (!u) fail('Usaha tidak dikenal.');
	if (money(state, p) < u.cost) fail(`Modal kurang, butuh ${formatRp(u.cost)}.`);
	addMoney(state, p, -u.cost);
	p.usaha = u.id;
	log(state, `${u.emoji} ${p.name} buka usaha ${u.name}${u.cost ? ` (modal ${formatRp(u.cost)})` : ' (tanpa modal)'}. Setoran ${formatRp(u.income)}/gajian.`);
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
	if (money(state, p) < total) fail(`Uang kurang, butuh ${formatRp(total)}.`);
	addMoney(state, p, -total);
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
	addMoney(state, p, total);
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
	if (bet > money(state, p)) fail(`Saldo kurang, taruhan maksimal ${formatRp(Math.max(0, money(state, p)))}.`);
	const pct = Math.round((rng() * 2 - 1) * 100);
	const delta = Math.round((bet * pct) / 100);
	addMoney(state, p, delta);
	// bandar judod sebagai lawan main: pemain menang -> saldo bandar berkurang; pemain kalah -> bertambah
	state.bandarJudod = (state.bandarJudod ?? 0) - delta;
	// catat beruntun judod (kalah & menang) untuk efek layar pemain; lawan jenis mereset yang lain
	p.judolLoseStreak = delta < 0 ? (p.judolLoseStreak ?? 0) + 1 : 0;
	p.judolWinStreak = delta > 0 ? (p.judolWinStreak ?? 0) + 1 : 0;
	state.seq += 1;
	state.lastJudol = { seq: state.seq, playerId: p.id, playerName: p.name, bet, pct, delta, streak: p.judolLoseStreak, winStreak: p.judolWinStreak, reels: judolReels(pct, rng) };
	log(
		state,
		`🎰 ${p.name} main judod ${formatRp(bet)}: ${delta >= 0 ? 'menang' : 'kalah'} ${formatRp(Math.abs(delta))} (${pct > 0 ? '+' : ''}${pct}%).`
	);
}

const cardKey = (id) => `card:${id}`;
const listingName = (state, key) => {
	if (isCardKey(key)) return 'Kartu Pemutihan';
	if (isUsahaKey(key)) {
		const u = usahaById(state.market?.[key]?.usaha);
		return u ? `usaha ${u.emoji} ${u.name}` : 'usaha';
	}
	return TILES[key].name;
};
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
	if (isUsahaKey(tileIdx)) {
		const seller = playerById(state, l.seller);
		if (!seller || seller.bankrupt || seller.usaha !== l.usaha) {
			dropListing(state, tileIdx);
			fail('Penjual sudah tidak punya usaha ini.');
		}
		return { l, own: null, tile: null };
	}
	const own = state.tiles[tileIdx];
	// aset se-group: anggota mana pun boleh jadi penjual (kepemilikan bersama)
	if (!own || (own.owner !== l.seller && !sameTeam(state, own.owner, l.seller))) {
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
	state.mkEvent = { seq: (state.mkEvent?.seq ?? 0) + 1, kind, tile: isCardKey(tileIdx) || isUsahaKey(tileIdx) ? tileIdx : +tileIdx, actor, target, price, ...extra };
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
	if (tileIdx === 'usaha' || isUsahaKey(tileIdx)) {
		const p = requireActive(state, userId);
		const u = usahaById(p.usaha);
		if (!u) fail('Kamu belum punya usaha.');
		const key = usahaKey(p.id);
		const m = market(state);
		const edit = !!m[key];
		const amount = parsePrice(price);
		m[key] = { seller: p.id, price: amount, offers: m[key]?.offers ?? {}, usaha: p.usaha };
		mkEvent(state, edit ? 'reprice' : 'list', key, p.id, null, amount);
		log(state, `🏷️ ${p.name} ${edit ? 'ubah harga' : 'jual'} usaha ${u.emoji} ${u.name} di Pasar: ${formatRp(amount)}.`);
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
	if (tileIdx === 'usaha' || isUsahaKey(tileIdx)) {
		const p = requireActive(state, userId);
		if (!market(state)[usahaKey(p.id)]) fail('Usaha ini tidak dijual.');
		dropListing(state, usahaKey(p.id));
		log(state, `${p.name} tarik usaha dari Pasar.`);
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
		if (sameTeam(state, buyer.id, seller.id)) fail('Se-group tak perlu beli dari partner — kartu & uang sudah bersama.');
		if (money(state, buyer) < price) fail(`Uang kurang, butuh ${formatRp(price)}.`);
		addMoney(state, buyer, -price);
		addMoney(state, seller, price);
		seller.jailFree -= 1;
		buyer.jailFree += 1;
		dropListing(state, tileIdx);
		mkEvent(state, 'sold', tileIdx, buyer.id, seller.id, price, { from: seller.id, to: buyer.id });
		log(state, `🤝 ${buyer.name} ${how} Kartu Pemutihan dari ${seller.name} seharga ${formatRp(price)}.`);
		return;
	}
	if (isUsahaKey(tileIdx)) {
		const { l } = requireListing(state, tileIdx);
		const seller = playerById(state, l.seller);
		if (buyer.id === seller.id) fail('Tidak bisa beli usahamu sendiri.');
		if (sameTeam(state, buyer.id, seller.id)) fail('Se-group tak perlu beli dari partner — usaha & uang sudah bersama.');
		if (buyer.usaha) fail('Kamu sudah punya usaha — cuma boleh satu.');
		if (money(state, buyer) < price) fail(`Uang kurang, butuh ${formatRp(price)}.`);
		const u = usahaById(l.usaha);
		addMoney(state, buyer, -price);
		addMoney(state, seller, price);
		seller.usaha = null;
		buyer.usaha = l.usaha;
		dropListing(state, tileIdx);
		mkEvent(state, 'sold', tileIdx, buyer.id, seller.id, price, { from: seller.id, to: buyer.id });
		log(state, `🤝 ${buyer.name} ${how} usaha ${u?.emoji ?? ''} ${u?.name ?? ''} dari ${seller.name} seharga ${formatRp(price)}.`);
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
	if (sameTeam(state, buyer.id, seller.id)) fail('Se-group tak perlu beli dari partner — aset & uang sudah bersama.');
	if (money(state, buyer) < price) fail(`Uang kurang, butuh ${formatRp(price)}.`);
	addMoney(state, buyer, -price);
	addMoney(state, seller, price);
	own.owner = buyer.id;
	dropListing(state, tileIdx);
	mkEvent(state, 'sold', tileIdx, buyer.id, seller.id, price, { from: seller.id, to: buyer.id });
	log(state, `🤝 ${buyer.name} ${how} ${tile.name} dari ${seller.name} seharga ${formatRp(price)}.`);
}

function marketBuy(state, userId, tileIdx) {
	const buyer = requireActive(state, userId);
	const { l } = requireListing(state, tileIdx);
	if (l.price == null) fail('Aset ini belum dipasang harga jual — kirim tawaran saja.');
	completeSale(state, tileIdx, buyer, l.price, 'beli');
}

/** Pastikan aset bisa ditawar walau belum dijual: kembalikan pemiliknya (penjual). */
function offerTarget(state, userId, tileIdx) {
	const buyer = requireActive(state, userId);
	if (tileIdx === 'card' || isCardKey(tileIdx)) fail('Kartu Pemutihan hanya bisa ditawar kalau dipasang di Pasar.');
	if (tileIdx === 'usaha' || isUsahaKey(tileIdx)) fail('Usaha hanya bisa ditawar kalau dipasang di Pasar.');
	const tile = TILES[tileIdx];
	const own = state.tiles[tileIdx];
	if (!tile || !isOwnable(tile) || !own) fail('Aset ini belum dimiliki siapa pun.');
	const seller = playerById(state, own.owner);
	if (!seller || seller.bankrupt) fail('Pemiliknya sudah tidak aktif.');
	if (seller.id === buyer.id) fail('Tidak bisa menawar asetmu sendiri.');
	sellable(state, tile, own); // tidak digadai & tak ada rumah di grup
	return { buyer, seller };
}

function marketOffer(state, userId, tileIdx, price) {
	const amount = parsePrice(price);
	let l = market(state)[tileIdx];
	let buyer;
	if (l) {
		// sudah ada listing/kontainer tawaran: validasi penjual masih pemilik
		buyer = requireActive(state, userId);
		({ l } = requireListing(state, tileIdx));
		if (l.seller === buyer.id) fail('Tidak bisa menawar asetmu sendiri.');
	} else {
		// belum dijual: buat kontainer tawaran langsung ke pemilik (price null = belum dipasang harga)
		const t = offerTarget(state, userId, tileIdx);
		buyer = t.buyer;
		l = market(state)[tileIdx] = { seller: t.seller.id, price: null, offers: {} };
	}
	l.offers[buyer.id] = amount;
	mkEvent(state, 'offer', tileIdx, buyer.id, l.seller, amount);
	log(
		state,
		l.price == null
			? `💬 ${buyer.name} menawar ${listingName(state, tileIdx)} ${formatRp(amount)} (belum dijual).`
			: `💬 ${buyer.name} menawar ${listingName(state, tileIdx)} ${formatRp(amount)} (harga jual ${formatRp(l.price)}).`
	);
}

/** hapus kontainer tawaran tanpa harga jual kalau tak ada tawaran tersisa */
function pruneOfferContainer(state, tileIdx) {
	const l = market(state)[tileIdx];
	if (l && l.price == null && Object.keys(l.offers ?? {}).length === 0) dropListing(state, tileIdx);
}

function marketCancelOffer(state, userId, tileIdx) {
	requireActive(state, userId);
	const l = market(state)[tileIdx];
	if (!l || !(userId in l.offers)) fail('Tidak ada tawaranmu.');
	delete l.offers[userId];
	pruneOfferContainer(state, tileIdx);
}

function requireSeller(state, userId, key) {
	if (isUsahaKey(key)) {
		if (key !== usahaKey(userId)) fail('Usaha ini bukan milikmu.');
		return requireActive(state, userId);
	}
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
	log(state, `${playerById(state, userId).name} tolak tawaran ${buyer?.name ?? 'pemain'} untuk ${listingName(state, tileIdx)}.`);
	pruneOfferContainer(state, tileIdx);
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
		syncTeams(state);
		checkWinner(state);
	}
}

function dispatch(state, userId, action, rng) {
	// saat dijeda host, hanya host yang boleh melanjutkan/mengakhiri; aksi lain diblok
	if (state.paused && action?.type !== 'pause' && action?.type !== 'endGame')
		fail('⏸️ Game sedang dijeda host.');
	// iklan tayang: pemain lain tidak bisa beraksi sampai hitung mundur habis atau bayar skip
	if (
		state.ad &&
		userId !== state.ad.by &&
		!state.ad.skipped.includes(userId) &&
		action?.type !== 'iklanSkip' &&
		action?.type !== 'pause' &&
		action?.type !== 'endGame'
	)
		fail('📺 Lagi ada iklan tayang. Tunggu sampai habis atau skip iklannya.');
	switch (action?.type) {
		case 'roll':
			return doRoll(state, requireTurn(state, userId), rng);

		case 'buy': {
			const p = requireTurn(state, userId);
			if (state.phase !== 'buy') fail('Tidak ada properti untuk dibeli.');
			const tile = TILES[state.pendingBuy];
			if (money(state, p) < tile.price) fail(`Uang kurang, butuh ${formatRp(tile.price)}.`);
			addMoney(state, p, -tile.price);
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

		case 'mergeInvite':
			return mergeInvite(state, userId, action.target);
		case 'mergeAccept':
			return mergeAccept(state, userId);
		case 'mergeReject':
			return mergeReject(state, userId);

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
			if (money(state, p) < JAIL_FINE) fail('Uang tidak cukup untuk denda.');
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
			if (money(state, p) < 0) fail('Saldo minus! Jual rumah, gadai properti, atau nyatakan rungkat.');
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

		case 'buildUsaha':
			return buildUsaha(state, userId, action.id);

		case 'iklan':
			return placeAd(state, userId, action.tile);
		case 'iklanSkip':
			return skipAd(state, userId);

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

		case 'pause': {
			if (state.hostId !== userId) fail('Hanya host yang bisa menjeda game.');
			if (state.status !== 'playing') fail('Game belum berjalan.');
			const on = action.on ?? !state.paused;
			if (!!on === !!state.paused) return; // tidak ada perubahan
			if (on) {
				state.paused = true;
				state.pausedAt = Date.now();
				log(state, '⏸️ Host menjeda permainan. Semua aksi dihentikan sementara.');
			} else {
				resumeFromPause(state);
				log(state, '▶️ Host melanjutkan permainan.');
			}
			return;
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
			const who = teamMembers(state, ranked[0].p).map((m) => m.name).join(' & ');
			log(
				state,
				`Host mengakhiri game. 🏆 ${who} menang dengan kekayaan ${formatRp(ranked[0].w)}.`
			);
			return;
		}

		default:
			fail('Aksi tidak dikenal.');
	}
}

/** Lanjut dari jeda: geser semua batas waktu maju sepanjang durasi jeda, lalu bersihkan flag. */
function resumeFromPause(state) {
	const delta = Date.now() - (state.pausedAt ?? Date.now());
	const shift = (v) => (typeof v === 'number' ? v + delta : v);
	if (state.pendingRent?.deadline) state.pendingRent.deadline = shift(state.pendingRent.deadline);
	if (state.kickVote?.deadline) state.kickVote.deadline = shift(state.kickVote.deadline);
	if (state.kickCoolUntil) state.kickCoolUntil = shift(state.kickCoolUntil);
	if (state.koNextAt) state.koNextAt = shift(state.koNextAt);
	if (state.koWarnUntil) state.koWarnUntil = shift(state.koWarnUntil);
	if (state.ad?.deadline) state.ad.deadline = shift(state.ad.deadline);
	state.paused = false;
	state.pausedAt = null;
}

/** Paksa lewati giliran pemain yang terputus. */
export function forceSkip(state, byUserId) {
	if (state.status !== 'playing') fail('Game belum berjalan.');
	if (state.paused) fail('⏸️ Game sedang dijeda host.');
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
	if (money(state, p) < 0) return goBankrupt(state, p);
	nextTurn(state);
}

/** State untuk dikirim ke client (tanpa urutan deck). */
export function publicState(state) {
	syncTeams(state); // pastikan kas bersama tercermin di kedua kartu anggota group
	const { decks, ...rest } = state;
	return { ...rest, deckSizes: { musibah: decks.musibah.length, takdir: decks.takdir.length } };
}
