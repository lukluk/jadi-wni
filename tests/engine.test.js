import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	createGame,
	addPlayer,
	startGame,
	applyAction,
	GameError,
	rentFor
} from '../server/game/engine.js';
import { TILES, MAX_LEVEL, START_MONEY } from '../src/lib/shared/board.js';

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
		if (p.money < 0) {
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
		if (s.phase === 'roll') {
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
			assert.equal(s.decks.musibah.length, 16);
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
	s.players[0].money = 10000;
	for (let i = 0; i < MAX_LEVEL; i++) {
		applyAction(s, owner, { type: 'build', tile: 1 });
		applyAction(s, owner, { type: 'build', tile: 3 });
	}
	assert.equal(s.tiles[1].level, MAX_LEVEL);
	assert.equal(rentFor(s, 1), 250);
	assert.throws(() => applyAction(s, owner, { type: 'build', tile: 1 }), /OKB/);
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
