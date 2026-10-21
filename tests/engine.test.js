import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	createGame,
	addPlayer,
	startGame,
	applyAction,
	GameError,
	rentFor,
	expireRent,
	expireKick,
	expireMerge
} from '../server/game/engine.js';
import { TILES, MAX_LEVEL, OKB_LEVEL, CARDS, richestId, surrenderPlan, START_MONEY, STOCKS, usahaKey, netWorth, ownsGroup, WIN_NETWORTH } from '../src/lib/shared/board.js';

function seeded(seed) {
	return () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};
}

const users = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));

function newGame(n = 4, rng = Math.random) {
	const s = createGame('TEST', users[0]);
	for (const u of users.slice(1, n)) addPlayer(s, u);
	startGame(s, rng);
	return s;
}

/** Bot sederhana: beli kalau mampu, bangun kalau bisa, gadai kalau minus, bangkrut kalau mentok. */
function botTurn(s, rng) {
	const p = s.players[s.turn];
	const act = (a) => applyAction(s, p.id, a, rng);
	let guard = 0;
	while (s.status === 'playing' && s.players[s.turn].id === p.id && guard++ < 50) {
		if (p.money < 0 || (s.phase === 'rent' && p.money < s.pendingRent.amount)) {
			const mine = Object.entries(s.tiles).filter(([, t]) => t.owner === p.id);
			const withHouse = mine.filter(([, t]) => t.level > 0).sort((a, b) => b[1].level - a[1].level);
			try {
				if (withHouse.length) act({ type: 'sell', tile: +withHouse[0][0] });
				else {
					const m = mine.find(([, t]) => !t.mortgaged);
					if (m) act({ type: 'mortgage', tile: +m[0] });
					else act({ type: 'bankrupt' });
				}
			} catch (e) {
				if (!(e instanceof GameError)) throw e;
				act({ type: 'bankrupt' });
			}
			continue;
		}
		if (s.phase === 'rent') act({ type: 'payRent' });
		else if (s.phase === 'roll') {
			if (p.inJail && p.jailFree) act({ type: 'useJailFree' });
			act({ type: 'roll' });
		} else if (s.phase === 'buy') {
			const price = TILES[s.pendingBuy].price;
			act({ type: p.money - price > 100 ? 'buy' : 'skip' });
		} else {
			for (const [i, t] of Object.entries(s.tiles)) {
				if (t.owner === p.id && p.money > 400) {
					try {
						act({ type: 'build', tile: +i });
					} catch (e) {
						if (!(e instanceof GameError)) throw e;
					}
				}
			}
			act({ type: 'endTurn' });
		}
	}
}

test('ratusan game acak berjalan tanpa error dan state konsisten', () => {
	let finished = 0;
	for (let seed = 1; seed <= 300; seed++) {
		const rng = seeded(seed);
		const s = newGame(2 + (seed % 3), rng);
		for (let t = 0; t < 1500 && s.status === 'playing'; t++) {
			botTurn(s, rng);
			for (const p of s.players) {
				assert.ok(p.pos >= 0 && p.pos < 40);
			}
			for (const [i, t] of Object.entries(s.tiles)) {
				assert.ok(t.level >= 0 && t.level <= MAX_LEVEL);
				assert.ok(!s.players.find((p) => p.id === t.owner).bankrupt);
				if (t.mortgaged) assert.equal(t.level, 0);
				assert.ok(['property', 'station', 'utility'].includes(TILES[+i].type));
			}
			assert.equal(s.decks.musibah.length, CARDS.musibah.length);
		}
		if (s.status === 'ended') finished++;
	}
	assert.ok(finished > 50, `hanya ${finished} game selesai`);
});

test('bukan giliran ditolak', () => {
	const s = newGame(2, seeded(7));
	const other = s.players[1].id;
	assert.throws(() => applyAction(s, other, { type: 'roll' }), GameError);
});

test('sewa dobel saat kuasai grup, dan sewa Rumah OKB', () => {
	const s = newGame(2, seeded(3));
	const owner = s.players[0].id;
	s.tiles[1] = { owner, level: 0, mortgaged: false };
	assert.equal(rentFor(s, 1), 2);
	s.tiles[3] = { owner, level: 0, mortgaged: false };
	assert.equal(rentFor(s, 1), 4);
	s.players[0].money = 5000;
	for (let i = 0; i < OKB_LEVEL; i++) {
		applyAction(s, owner, { type: 'build', tile: 1 });
		applyAction(s, owner, { type: 'build', tile: 3 });
	}
	assert.equal(s.tiles[1].level, OKB_LEVEL);
	assert.equal(rentFor(s, 1), TILES[1].rent[OKB_LEVEL]);
	assert.throws(() => applyAction(s, owner, { type: 'build', tile: 1 }), /Sawit hanya di/);
});

test('Kebun Sawit hanya di daerah sawit (Medan, Makassar, Balikpapan)', () => {
	const s = newGame(2, seeded(3));
	const owner = s.players[0].id;
	const idx = ['Medan', 'Makassar', 'Balikpapan'].map((n) => TILES.findIndex((t) => t.name === n));
	for (const i of idx) s.tiles[i] = { owner, level: 0, mortgaged: false };
	s.players[0].money = 5000;
	for (let i = 0; i < MAX_LEVEL; i++) for (const t of idx) applyAction(s, owner, { type: 'build', tile: t });
	for (const t of idx) assert.equal(s.tiles[t].level, MAX_LEVEL);
	assert.throws(() => applyAction(s, owner, { type: 'build', tile: idx[0] }), /Sawit, mentok/);
});

test('kota non-sawit tidak menghalangi bangun merata di grup', () => {
	const s = newGame(2, seeded(3));
	const owner = s.players[0].id;
	const idx = ['Denpasar', 'Labuan Bajo', 'Raja Ampat'].map((n) => TILES.findIndex((t) => t.name === n));
	for (const i of idx) s.tiles[i] = { owner, level: 0, mortgaged: false };
	s.players[0].money = 5000;
	for (let i = 0; i < OKB_LEVEL; i++) for (const t of idx) applyAction(s, owner, { type: 'build', tile: t });
	applyAction(s, owner, { type: 'build', tile: idx[2] }); // Raja Ampat -> Sawit
	assert.equal(s.tiles[idx[2]].level, MAX_LEVEL);
	assert.throws(() => applyAction(s, owner, { type: 'build', tile: idx[0] }), /Sawit hanya di/);
});

test('Karhutla: semua Kebun Sawit hangus + denda', () => {
	const s = newGame(2, seeded(3));
	const [a, b] = s.players;
	const idx = ['Medan', 'Makassar', 'Balikpapan'].map((n) => TILES.findIndex((t) => t.name === n));
	for (const i of idx) s.tiles[i] = { owner: a.id, level: MAX_LEVEL, mortgaged: false };
	s.tiles[idx[0]].owner = b.id; // satu kebun milik pemain lain ikut terbakar
	const fine = 150 * 3;
	a.money = b.money = 5000;
	s.decks.musibah = [CARDS.musibah.findIndex((c) => c.fx.karhutla)];
	a.pos = 14; // + dadu 4+4 = 22 (Musibah)
	const kas = s.kasNegara;
	applyAction(s, a.id, { type: 'roll' }, () => 0.5);
	for (const i of idx) assert.equal(s.tiles[i].level, OKB_LEVEL);
	assert.equal(a.money, 5000 - fine * 2);
	assert.equal(b.money, 5000 - fine);
	assert.equal(s.kasNegara, kas + fine * 3);
});

test('bangun harus merata', () => {
	const s = newGame(2, seeded(4));
	const owner = s.players[0].id;
	s.tiles[1] = { owner, level: 0, mortgaged: false };
	s.tiles[3] = { owner, level: 0, mortgaged: false };
	applyAction(s, owner, { type: 'build', tile: 1 });
	assert.throws(() => applyAction(s, owner, { type: 'build', tile: 1 }), /merata/);
	assert.equal(s.players[0].money, START_MONEY - 50);
});

test('sewa aset pemilik yang di Ruang Sidang masuk Kas Negara', () => {
	const s = newGame(2, seeded(5));
	const [owner, visitor] = s.players;
	s.tiles[39] = { owner: owner.id, level: 0, mortgaged: false };
	owner.inJail = true;
	owner.pos = 10;
	// paksa visitor giliran & mendarat di SCBD (39) dengan dadu 1+2
	s.turn = 1;
	visitor.pos = 36;
	const before = { o: owner.money, v: visitor.money, k: s.kasNegara };
	const dice = [0, 1 / 6]; // -> 1 dan 2
	let n = 0;
	applyAction(s, visitor.id, { type: 'roll' }, () => dice[n++ % 2]);
	assert.equal(visitor.pos, 39);
	// sewa menunggu persetujuan: belum ada uang berpindah
	assert.equal(s.phase, 'rent');
	assert.equal(visitor.money, before.v);
	assert.throws(() => applyAction(s, visitor.id, { type: 'endTurn' }), GameError);
	applyAction(s, visitor.id, { type: 'payRent' });
	assert.equal(s.phase, 'end');
	assert.equal(owner.money, before.o);
	assert.equal(visitor.money, before.v - 50);
	assert.equal(s.kasNegara, before.k + 50);
});

test('bayar denda langsung bebas, denda masuk Kas Negara', () => {
	const s = newGame(2, seeded(6));
	const p = s.players[0];
	p.inJail = true;
	applyAction(s, p.id, { type: 'payJail' });
	assert.equal(p.inJail, false);
	assert.equal(s.kasNegara, 50);
	assert.equal(s.phase, 'roll');
});

test('marketplace: jual, ubah harga, beli langsung', () => {
	const s = newGame(2, seeded(11));
	const [a, b] = s.players.map((p) => p.id);
	s.tiles[1] = { owner: a, level: 0, mortgaged: false };
	assert.throws(() => applyAction(s, b, { type: 'mkList', tile: 1, price: 50 }), GameError); // bukan miliknya
	applyAction(s, a, { type: 'mkList', tile: 1, price: 80 });
	applyAction(s, a, { type: 'mkList', tile: 1, price: 70 }); // ubah harga
	assert.equal(s.market[1].price, 70);
	assert.throws(() => applyAction(s, a, { type: 'mkBuy', tile: 1 }), GameError); // beli sendiri
	s.players[1].money = 60;
	assert.throws(() => applyAction(s, b, { type: 'mkBuy', tile: 1 }), /Uang kurang/);
	s.players[1].money = 100;
	const sellerBefore = s.players[0].money;
	applyAction(s, b, { type: 'mkBuy', tile: 1 });
	assert.equal(s.tiles[1].owner, b);
	assert.equal(s.players[1].money, 30);
	assert.equal(s.players[0].money, sellerBefore + 70);
	assert.equal(s.market[1], undefined);
});

test('marketplace: nego, tolak, terima', () => {
	const s = newGame(3, seeded(12));
	const [a, b, c] = s.players.map((p) => p.id);
	s.tiles[1] = { owner: a, level: 0, mortgaged: false };
	applyAction(s, a, { type: 'mkList', tile: 1, price: 100 });
	applyAction(s, b, { type: 'mkOffer', tile: 1, price: 40 });
	applyAction(s, c, { type: 'mkOffer', tile: 1, price: 55 });
	assert.deepEqual(s.market[1].offers, { [b]: 40, [c]: 55 });
	applyAction(s, a, { type: 'mkReject', tile: 1, buyer: b });
	assert.equal(b in s.market[1].offers, false);
	assert.throws(() => applyAction(s, b, { type: 'mkAccept', tile: 1, buyer: c }), GameError); // bukan penjual
	applyAction(s, a, { type: 'mkAccept', tile: 1, buyer: c });
	assert.equal(s.tiles[1].owner, c);
	assert.equal(s.players[2].money, START_MONEY - 55);
	assert.equal(s.market[1], undefined);
});

test('marketplace: tawar aset yang belum dijual, lalu terima', () => {
	const s = newGame(2, seeded(21));
	const [a, b] = s.players.map((p) => p.id);
	s.tiles[1] = { owner: a, level: 0, mortgaged: false };
	assert.throws(() => applyAction(s, a, { type: 'mkOffer', tile: 1, price: 40 }), /asetmu sendiri/); // pemilik tak boleh menawar
	applyAction(s, b, { type: 'mkOffer', tile: 1, price: 40 }); // belum ada listing -> buat kontainer tawaran
	assert.equal(s.market[1].price, null);
	assert.deepEqual(s.market[1].offers, { [b]: 40 });
	assert.throws(() => applyAction(s, b, { type: 'mkBuy', tile: 1 }), /belum dipasang harga/); // tak ada harga jual
	const sellerBefore = s.players[0].money;
	applyAction(s, a, { type: 'mkAccept', tile: 1, buyer: b });
	assert.equal(s.tiles[1].owner, b);
	assert.equal(s.players[0].money, sellerBefore + 40);
	assert.equal(s.market[1], undefined);
});

test('marketplace: kontainer tawaran tanpa harga hilang saat tawaran terakhir dibatalkan/ditolak', () => {
	const s = newGame(2, seeded(22));
	const [a, b] = s.players.map((p) => p.id);
	s.tiles[1] = { owner: a, level: 0, mortgaged: false };
	applyAction(s, b, { type: 'mkOffer', tile: 1, price: 30 });
	applyAction(s, b, { type: 'mkCancelOffer', tile: 1 });
	assert.equal(s.market[1], undefined); // kontainer kosong tanpa harga dibersihkan
	applyAction(s, b, { type: 'mkOffer', tile: 1, price: 35 });
	applyAction(s, a, { type: 'mkReject', tile: 1, buyer: b });
	assert.equal(s.market[1], undefined);
	// aset digadai tidak bisa ditawar
	s.tiles[1].mortgaged = true;
	assert.throws(() => applyAction(s, b, { type: 'mkOffer', tile: 1, price: 30 }), /digadai/);
});

test('usaha: beli/jual di pasar, pindah pemilik, masuk net worth', () => {
	const s = newGame(2, seeded(31));
	const [a, b] = s.players.map((p) => p.id);
	applyAction(s, a, { type: 'buildUsaha', id: 'warung' }); // modal 250
	assert.equal(s.players[0].usaha, 'warung');
	assert.throws(() => applyAction(s, a, { type: 'buildUsaha', id: 'pabrik' }), /cuma boleh satu/); // maks 1
	// net worth termasuk nilai usaha (= modal 250)
	assert.equal(netWorth(s, s.players[0]) - (START_MONEY - 250), 250);
	// jual ke pasar
	applyAction(s, a, { type: 'mkList', tile: 'usaha', price: 400 });
	assert.equal(s.market[usahaKey(a)].price, 400);
	assert.throws(() => applyAction(s, a, { type: 'mkBuy', tile: usahaKey(a) }), /usahamu sendiri/);
	const bBefore = s.players[1].money, aBefore = s.players[0].money;
	applyAction(s, b, { type: 'mkBuy', tile: usahaKey(a) });
	assert.equal(s.players[1].usaha, 'warung');
	assert.equal(s.players[0].usaha, null);
	assert.equal(s.players[1].money, bBefore - 400);
	assert.equal(s.players[0].money, aBefore + 400);
	assert.equal(s.market[usahaKey(a)], undefined);
	// pembeli yang sudah punya usaha tak bisa beli lagi
	applyAction(s, a, { type: 'buildUsaha', id: 'reseller' });
	applyAction(s, b, { type: 'mkList', tile: 'usaha', price: 100 });
	assert.throws(() => applyAction(s, a, { type: 'mkBuy', tile: usahaKey(b) }), /sudah punya usaha/);
});

test('marketplace: aset bergedung / digadai tidak bisa dijual, bangkrut bersihkan listing', () => {
	const s = newGame(2, seeded(13));
	const [a, b] = s.players.map((p) => p.id);
	s.tiles[1] = { owner: a, level: 0, mortgaged: false };
	s.tiles[3] = { owner: a, level: 0, mortgaged: false };
	applyAction(s, a, { type: 'mkList', tile: 1, price: 90 });
	applyAction(s, b, { type: 'mkOffer', tile: 1, price: 10 });
	applyAction(s, a, { type: 'build', tile: 1 }); // bangun -> listing grup ditarik
	assert.equal(s.market[1], undefined);
	assert.throws(() => applyAction(s, a, { type: 'mkList', tile: 3, price: 90 }), /rumah/);
	applyAction(s, a, { type: 'sell', tile: 1 });
	applyAction(s, a, { type: 'mortgage', tile: 3 });
	assert.throws(() => applyAction(s, a, { type: 'mkList', tile: 3, price: 90 }), /Tebus/);
	applyAction(s, a, { type: 'mkList', tile: 1, price: 90 });
	applyAction(s, a, { type: 'bankrupt' });
	assert.deepEqual(s.market, {});
});

test('saham: beli kurangi saldo, jual tambah saldo, harga bergerak tiap giliran', () => {
	const s = newGame(2, seeded(21));
	const [a] = s.players.map((p) => p.id);
	const price = s.stocks.BACA.price;
	const before = s.players[0].money;
	assert.throws(() => applyAction(s, a, { type: 'stockBuy', sym: 'XXXX', qty: 1 }), GameError);
	assert.throws(() => applyAction(s, a, { type: 'stockBuy', sym: 'BACA', qty: 0 }), GameError);
	assert.throws(() => applyAction(s, a, { type: 'stockBuy', sym: 'BACA', qty: 1e6 }), GameError);
	applyAction(s, a, { type: 'stockBuy', sym: 'BACA', qty: 3 });
	assert.equal(s.players[0].money, before - price * 3);
	assert.equal(s.players[0].stocks.BACA.qty, 3);
	assert.throws(() => applyAction(s, a, { type: 'stockSell', sym: 'BACA', qty: 4 }), /hanya punya 3/);
	s.stocks.BACA.price = price + 10;
	applyAction(s, a, { type: 'stockSell', sym: 'BACA', qty: 2 });
	assert.equal(s.players[0].money, before - price * 3 + (price + 10) * 2);
	assert.equal(s.players[0].stocks.BACA.qty, 1);
	applyAction(s, a, { type: 'stockSell', sym: 'BACA', qty: 1 });
	assert.equal(s.players[0].stocks.BACA, undefined);
	// uang tidak cukup
	s.players[0].money = 10;
	assert.throws(() => applyAction(s, a, { type: 'stockBuy', sym: 'BACA', qty: 1 }), /Uang kurang/);
});

test('saham: harga tetap dalam batas setelah banyak giliran, netWorth menghitung saham', () => {
	const s = newGame(2, seeded(22));
	const a = s.players[0].id;
	applyAction(s, a, { type: 'stockBuy', sym: 'GATO', qty: 5 });
	for (let i = 0; i < 400; i++) {
		const p = s.players[s.turn];
		applyAction(s, p.id, { type: 'roll' }, seeded(i + 1));
		if (s.phase === 'buy') applyAction(s, p.id, { type: 'skip' });
		if (s.status !== 'playing') break;
		if (s.players[s.turn].id === p.id && s.phase === 'end') applyAction(s, p.id, { type: 'endTurn' });
		else if (s.players[s.turn].id === p.id) break;
	}
	for (const [sym, st] of Object.entries(s.stocks)) {
		const def = STOCKS.find((x) => x.sym === sym);
		assert.ok(st.price >= Math.ceil(def.base * 0.2) && st.price <= def.base * 5, `${sym} ${st.price}`);
		assert.ok(st.history.length <= 24);
	}
});

function rentSetup(visitorMoney) {
	const s = newGame(2, seeded(11));
	const [owner, visitor] = s.players;
	s.tiles[39] = { owner: owner.id, level: 0, mortgaged: false };
	s.tiles[37] = { owner: visitor.id, level: 0, mortgaged: false };
	s.turn = 1;
	visitor.pos = 36;
	visitor.money = visitorMoney;
	const dice = [0, 1 / 6];
	let n = 0;
	applyAction(s, visitor.id, { type: 'roll' }, () => dice[n++ % 2]);
	assert.equal(s.phase, 'rent');
	return { s, owner, visitor };
}

test('menyerah saat ditagih: aset dijual otomatis, sisa > 0 -> lanjut tanpa aset', () => {
	const { s, owner, visitor } = rentSetup(10);
	visitor.stocks = { [STOCKS[0].sym]: { qty: 2, cost: 0 } };
	const rent = s.pendingRent.amount;
	const plan = surrenderPlan(s, visitor);
	const expectLeft = 10 + TILES[37].price + 2 * s.stocks[STOCKS[0].sym].price - rent;
	assert.equal(plan.outcome, 'lanjut');
	assert.equal(plan.left, expectLeft);
	const ownerBefore = owner.money;
	applyAction(s, visitor.id, { type: 'bankrupt' });
	assert.equal(visitor.bankrupt, false);
	assert.equal(s.status, 'playing');
	assert.equal(s.tiles[37], undefined); // aset kembali ke bank
	assert.deepEqual(visitor.stocks, {});
	assert.equal(visitor.money, expectLeft);
	assert.equal(owner.money, ownerBefore + rent);
	assert.equal(s.pendingRent, null);
	assert.notEqual(s.phase, 'rent');
});

test('menyerah saat ditagih: sisa <= 0 -> bangkrut, aset ke penagih', () => {
	const { s, owner, visitor } = rentSetup(10);
	s.pendingRent.amount = 100000;
	assert.equal(surrenderPlan(s, visitor).outcome, 'bangkrut');
	applyAction(s, visitor.id, { type: 'bankrupt' });
	assert.equal(visitor.bankrupt, true);
	assert.equal(s.tiles[37].owner, owner.id);
	assert.equal(s.status, 'ended');
});

test('menyerah tanpa utang = keluar dari game (bangkrut)', () => {
	const s = newGame(3, seeded(2));
	const p = s.players[1];
	assert.equal(surrenderPlan(s, p).outcome, 'keluar');
	applyAction(s, p.id, { type: 'bankrupt' });
	assert.equal(p.bankrupt, true);
});

test('sewa harus dibayar manual; uang kurang tidak bisa bayar', () => {
	const s = newGame(2, seeded(11));
	const [owner, visitor] = s.players;
	s.tiles[39] = { owner: owner.id, level: 0, mortgaged: false };
	s.tiles[37] = { owner: visitor.id, level: 0, mortgaged: false };
	s.turn = 1;
	visitor.pos = 36;
	visitor.money = 10;
	const dice = [0, 1 / 6];
	let n = 0;
	applyAction(s, visitor.id, { type: 'roll' }, () => dice[n++ % 2]);
	assert.equal(s.phase, 'rent');
	assert.throws(() => applyAction(s, visitor.id, { type: 'payRent' }), GameError);
	assert.throws(() => applyAction(s, owner.id, { type: 'payRent' }), GameError);
});

test('tagihan sewa punya batas 2 menit; habis = menyerah (aset dijual otomatis)', () => {
	const s = newGame(2, seeded(11));
	const [owner, visitor] = s.players;
	s.tiles[39] = { owner: owner.id, level: 0, mortgaged: false };
	s.tiles[37] = { owner: visitor.id, level: 0, mortgaged: false };
	s.turn = 1;
	visitor.pos = 36;
	const dice = [0, 1 / 6];
	let n = 0;
	applyAction(s, visitor.id, { type: 'roll' }, () => dice[n++ % 2]);
	assert.equal(s.phase, 'rent');
	const dl = s.pendingRent.deadline;
	assert.ok(dl - Date.now() >= 119_000);
	assert.equal(expireRent(s, dl - 1000), false);
	assert.equal(expireRent(s, dl + 1), true);
	assert.equal(s.tiles[37], undefined); // sisa > 0: aset dijual, lanjut main
	assert.equal(visitor.bankrupt, false);
	assert.notEqual(s.phase, 'rent');
});

test('judol: hasil -100%..+100% dari taruhan, taruhan tidak boleh melebihi saldo', () => {
	const s = newGame(2, seeded(3));
	const p = s.players[0];
	const start = p.money;
	applyAction(s, p.id, { type: 'judol', amount: 100 }, () => 0); // -100%
	assert.equal(p.money, start - 100);
	assert.equal(s.lastJudol.pct, -100);
	applyAction(s, p.id, { type: 'judol', amount: 100 }, () => 0.99999); // +100%
	assert.equal(p.money, start);
	assert.equal(s.lastJudol.delta, 100);
	assert.throws(() => applyAction(s, p.id, { type: 'judol', amount: p.money + 1 }, () => 0.5), GameError);
	assert.throws(() => applyAction(s, p.id, { type: 'judol', amount: 0 }, () => 0.5), GameError);
});

test('kekayaan bersih tembus 10 M -> otomatis menang', () => {
	const s = newGame(2, seeded(3));
	const [a, b] = s.players;
	a.money = 9999;
	applyAction(s, b.id, { type: 'judol', amount: 1 }, () => 0.5);
	assert.equal(s.status, 'playing');
	b.money = 9999;
	a.money = 10001;
	applyAction(s, b.id, { type: 'judol', amount: 1 }, () => 0.5);
	assert.equal(s.status, 'ended');
	assert.equal(s.winner, a.id);
});

test('judol slot: gulungan konsisten dengan hasil', () => {
	const skulls = (r) => r.filter((x) => x === '💀').length;
	for (const [rngv, check] of [
		[0, (j) => assert.deepEqual(j.reels, ['💀', '💀', '💀'])], // -100%
		[0.99999, (j) => assert.deepEqual(j.reels, ['7️⃣', '7️⃣', '7️⃣'])] // +100%
	]) {
		const s = newGame(2, seeded(3));
		applyAction(s, s.players[0].id, { type: 'judol', amount: 10 }, () => rngv);
		check(s.lastJudol);
	}
	for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
		const s = newGame(2, seeded(seed));
		applyAction(s, s.players[0].id, { type: 'judol', amount: 10 }, seeded(seed * 11));
		const { pct, reels } = s.lastJudol;
		assert.equal(reels.length, 3);
		if (pct > 0) assert.equal(skulls(reels), 0);
		if (pct < 0) assert.ok(skulls(reels) >= 1);
	}
});

test('saham: tiap giliran menambah candle OHLC yang valid', () => {
	const s = newGame(2, seeded(8));
	for (let i = 0; i < 5; i++) botTurn(s, seeded(i));
	for (const st of Object.values(s.stocks)) {
		assert.ok(st.candles.length >= 1);
		for (const c of st.candles) assert.ok(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.l >= 1);
		assert.equal(st.candles.at(-1).c, st.price);
	}
});

test('kartu Pemutihan bisa dijual di Pasar dan pindah ke pembeli', () => {
	const s = newGame(2, seeded(4));
	const [a, b] = s.players;
	assert.throws(() => applyAction(s, a.id, { type: 'mkList', tile: 'card', price: 40 }), GameError);
	a.jailFree = 1;
	applyAction(s, a.id, { type: 'mkList', tile: 'card', price: 40 });
	const key = 'card:' + a.id;
	assert.equal(s.market[key].price, 40);
	assert.throws(() => applyAction(s, a.id, { type: 'mkBuy', tile: key }), GameError);
	const ma = a.money;
	const mb = b.money;
	applyAction(s, b.id, { type: 'mkBuy', tile: key });
	assert.equal(a.jailFree, 0);
	assert.equal(b.jailFree, 1);
	assert.equal(a.money, ma + 40);
	assert.equal(b.money, mb - 40);
	assert.equal(s.market[key], undefined);
	assert.equal(s.mkEvent.kind, 'sold');
});

test('vote kick: butuh 70% pemain lain setuju', () => {
	const s = newGame(4, seeded(8));
	const [a, b, c, d] = s.players;
	assert.throws(() => applyAction(s, a.id, { type: 'kickStart', target: a.id }), GameError);
	applyAction(s, a.id, { type: 'kickStart', target: d.id }); // a setuju otomatis, butuh ceil(3*0.7)=3
	assert.throws(() => applyAction(s, b.id, { type: 'kickStart', target: c.id }), GameError); // sudah ada voting
	assert.throws(() => applyAction(s, d.id, { type: 'kickVote', agree: false }), GameError); // target tidak boleh vote
	applyAction(s, b.id, { type: 'kickVote', agree: true });
	assert.equal(d.bankrupt, false);
	applyAction(s, c.id, { type: 'kickVote', agree: true });
	assert.equal(d.bankrupt, true);
	assert.equal(s.kickVote, null);
});

test('vote kick gagal kalau penolak terlalu banyak, atau habis waktu', () => {
	const s = newGame(4, seeded(9));
	const [a, b, c, d] = s.players;
	applyAction(s, a.id, { type: 'kickStart', target: d.id });
	applyAction(s, b.id, { type: 'kickVote', agree: false });
	assert.equal(s.kickVote, null);
	assert.equal(d.bankrupt, false);
	const s2 = newGame(3, seeded(10));
	applyAction(s2, s2.players[0].id, { type: 'kickStart', target: s2.players[2].id });
	assert.equal(expireKick(s2, Date.now() + 1000), false);
	assert.equal(expireKick(s2, Date.now() + 60_000), true);
	assert.equal(s2.kickVote, null);
	assert.throws(() => applyAction(newGame(2, seeded(1)), 'a', { type: 'kickStart', target: 'b' }), GameError);
});

test('richestId: raja = kekayaan bersih tertinggi, tidak ada kalau seri', () => {
	const s = newGame(2, seeded(5));
	assert.equal(richestId(s), null); // seri
	s.players[1].money += 100;
	assert.equal(richestId(s), s.players[1].id);
	s.tiles[1] = { owner: s.players[0].id, level: 0, mortgaged: false }; // properti dihitung sebagai aset
	s.players[0].money -= TILES[1].price - 200;
	assert.equal(richestId(s), s.players[0].id);
	s.players[0].bankrupt = true;
	assert.equal(richestId(s), null);
});

// ---------- merger (2 pemain jadi 1 group) ----------

/** bentuk group a+b lewat aksi ajak & setujui; kembalikan { a, b } */
function mergeAB(s) {
	const a = s.players.find((p) => p.id === 'a');
	const b = s.players.find((p) => p.id === 'b');
	applyAction(s, a.id, { type: 'mergeInvite', target: b.id });
	applyAction(s, b.id, { type: 'mergeAccept' });
	return { a, b };
}

test('merger: ajak & setujui menggabung kas jadi kas bersama', () => {
	const s = newGame(2);
	const a = s.players.find((p) => p.id === 'a');
	const b = s.players.find((p) => p.id === 'b');
	a.money = 1000;
	b.money = 400;
	mergeAB(s);
	assert.ok(a.teamId && a.teamId === b.teamId, 'teamId kedua pemain sama');
	assert.equal(a.money, 1400, 'kas bersama = gabungan');
	assert.equal(b.money, 1400, 'kedua kartu menampilkan kas bersama');
	// belanja oleh salah satu memotong kas bersama keduanya
	s.tiles[1] = { owner: a.id, level: 0, mortgaged: false };
	applyAction(s, a.id, { type: 'mortgage', tile: 1 }); // +price/2 ke kas bersama
	assert.equal(a.money, b.money, 'kas tetap sinkron setelah transaksi');
});

test('merger: tidak saling kena sewa dengan anggota se-group', () => {
	const s = newGame(2);
	const { a, b } = mergeAB(s);
	const before = a.money;
	s.tiles[3] = { owner: a.id, level: 3, mortgaged: false }; // Bekasi, milik a
	// giliran b, berdiri di petak 1, lempar [1,1] -> mendarat di petak 3 (milik partner)
	s.turn = s.players.indexOf(b);
	b.pos = 1;
	s.phase = 'roll';
	s.doubles = 0;
	applyAction(s, b.id, { type: 'roll' }, () => 0);
	assert.equal(b.pos, 3, 'mendarat di properti partner');
	assert.equal(s.pendingRent, null, 'tidak ada tagihan sewa ke partner');
	assert.equal(a.money, before, 'kas bersama tidak berubah');
});

test('merger: monopoli & bangun rumah di tanah partner (kepemilikan bersama)', () => {
	const s = newGame(2);
	const { a, b } = mergeAB(s);
	a.money = b.money = 5000;
	// grup coklat: Cikarang (1) milik a, Bekasi (3) milik b -> dikuasai group
	s.tiles[1] = { owner: a.id, level: 0, mortgaged: false };
	s.tiles[3] = { owner: b.id, level: 0, mortgaged: false };
	assert.ok(ownsGroup(s, a.id, 'coklat'), 'group menguasai grup coklat bersama');
	const before = a.money;
	// a membangun di Bekasi (milik partner) -> boleh, bayar dari kas bersama
	applyAction(s, a.id, { type: 'build', tile: 3 });
	assert.equal(s.tiles[3].level, 1, 'rumah terbangun di tanah partner');
	assert.equal(a.money, before - 50, 'biaya bangun dipotong kas bersama');
	assert.equal(b.money, a.money, 'kas tetap sinkron');
});

test('merger: stasiun gabungan dihitung sebagai milik satu group', () => {
	const s = newGame(2);
	const { a, b } = mergeAB(s);
	s.tiles[5] = { owner: a.id, level: 0, mortgaged: false }; // KRL
	s.tiles[15] = { owner: b.id, level: 0, mortgaged: false }; // Transjakarta
	// 2 stasiun gabungan -> sewa indeks ke-2 (STATION_RENT[2] = 50)
	assert.equal(rentFor(s, 5), 50, 'sewa stasiun pakai jumlah stasiun gabungan group');
});

test('merger: kekayaan bersih digabung & menang bareng', () => {
	const s = newGame(2);
	const { a, b } = mergeAB(s);
	a.money = b.money = 6000;
	s.tiles[30] = { owner: b.id, level: 0, mortgaged: false }; // BSD (300)
	const w = netWorth(s, a);
	assert.equal(w, netWorth(s, b), 'netWorth sama di kedua anggota');
	assert.equal(w, 6000 + 300, 'kas bersama dihitung sekali + aset partner');
	// dorong melewati target menang, lalu satu aksi memicu checkWinner
	a.money = b.money = WIN_NETWORTH + 100;
	s.turn = s.players.indexOf(a);
	s.phase = 'roll';
	applyAction(s, a.id, { type: 'roll' }, () => 0.99);
	assert.equal(s.status, 'ended', 'game selesai saat group tembus target');
	assert.ok(s.winner === a.id || s.winner === b.id, 'pemenang anggota group');
});

test('merger: bangkrut sehidup-semati (satu kena, dua-duanya bangkrut)', () => {
	const s = newGame(3);
	const { a, b } = mergeAB(s);
	const c = s.players.find((p) => p.id === 'c');
	a.money = b.money = 100;
	s.tiles[1] = { owner: c.id, level: 0, mortgaged: false };
	// b sedang ditagih sewa besar milik c, kas bersama tak cukup & tak ada aset
	s.turn = s.players.indexOf(b);
	s.phase = 'rent';
	s.pendingRent = { tile: 1, amount: 9999, deadline: Date.now() + 100000 };
	applyAction(s, b.id, { type: 'bankrupt' });
	assert.ok(a.bankrupt && b.bankrupt, 'kedua anggota group bangkrut bareng');
	assert.equal(s.tiles[1].owner, c.id, 'aset penagih tetap miliknya');
});

test('merger: ajakan ditolak & kadaluarsa membersihkan tawaran', () => {
	const s = newGame(2);
	const a = s.players.find((p) => p.id === 'a');
	const b = s.players.find((p) => p.id === 'b');
	// ditolak
	applyAction(s, a.id, { type: 'mergeInvite', target: b.id });
	assert.ok(s.mergeOffer, 'ada ajakan berjalan');
	applyAction(s, b.id, { type: 'mergeReject' });
	assert.equal(s.mergeOffer, null, 'ajakan hilang setelah ditolak');
	assert.ok(!a.teamId && !b.teamId, 'tak ada group terbentuk');
	// kadaluarsa: lewat deadline -> expireMerge membersihkan tawaran
	applyAction(s, a.id, { type: 'mergeInvite', target: b.id });
	assert.equal(expireMerge(s, s.mergeOffer.deadline - 1), false, 'belum lewat deadline, tawaran tetap');
	assert.ok(s.mergeOffer, 'ajakan masih ada sebelum deadline');
	assert.equal(expireMerge(s, s.mergeOffer.deadline + 1), true, 'lewat deadline -> berubah');
	assert.equal(s.mergeOffer, null, 'ajakan hilang setelah kadaluarsa');
	assert.ok(!a.teamId && !b.teamId, 'tetap tak ada group terbentuk');
});
