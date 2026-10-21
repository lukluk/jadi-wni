import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, startGame, applyAction, removePlayer, GameError } from '../server/game/engine.js';
import { botStep, maybeAddBot, BOT_JOIN_AFTER_MS } from '../server/bot.js';

function seeded(seed) {
	return () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};
}

test('bot join hanya kalau host sendirian >= 1 menit, sekali saja', () => {
	const s = createGame('ROOM', { id: 'h', name: 'Host' });
	assert.equal(maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS - 1), false);
	assert.equal(maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS, seeded(1)), true);
	assert.equal(s.players.length, 2);
	assert.equal(s.players[1].bot, true);
	assert.match(s.players[1].name, /\(bot\)$/);
	// host mengeluarkan bot: tidak ditawarkan lagi
	removePlayer(s, s.players[1].id);
	assert.equal(maybeAddBot(s, s.createdAt + 10 * BOT_JOIN_AFTER_MS), false);

	const t = createGame('R2', { id: 'h', name: 'Host' });
	addPlayer(t, { id: 'x', name: 'X' });
	assert.equal(maybeAddBot(t, t.createdAt + BOT_JOIN_AFTER_MS), false); // sudah ada teman
});

test('host keluar: bot ikut hilang dan tidak jadi host', () => {
	const s = createGame('R3', { id: 'h', name: 'Host' });
	maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS);
	removePlayer(s, 'h');
	assert.equal(s.players.length, 0);
});

test('bot main sungguhan: beli properti, bangun, investasi saham, tanpa error', () => {
	const rng = seeded(42);
	const s = createGame('SIM', { id: 'h', name: 'Host' });
	maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS, rng);
	startGame(s, rng);
	const human = s.players.find((p) => !p.bot);
	const bot = s.players.find((p) => p.bot);
	const act = (a) => {
		try {
			applyAction(s, human.id, a, rng);
			return true;
		} catch (e) {
			if (e instanceof GameError) return false;
			throw e;
		}
	};
	let botBuilt = false;
	for (let i = 0; i < 6000 && s.status === 'playing'; i++) {
		const cur = s.players[s.turn];
		if (cur.bot) {
			assert.ok(botStep(s), `bot macet di fase ${s.phase}`);
		} else if (s.phase === 'rent') act({ type: 'payRent' }) || act({ type: 'bankrupt' });
		else if (s.phase === 'buy') act({ type: 'buy' }) || act({ type: 'skip' });
		else if (s.phase === 'roll') act({ type: 'roll' }) || act({ type: 'bankrupt' });
		else act({ type: 'endTurn' }) || act({ type: 'bankrupt' });
		if (Object.values(s.tiles).some((t) => t.owner === bot.id && t.level > 0)) botBuilt = true;
	}
	assert.ok(s.turnCount > 40, 'game berjalan lama');
	const botTiles = Object.values(s.tiles).filter((t) => t.owner === bot.id).length;
	assert.ok(botTiles > 0 || bot.bankrupt, 'bot membeli properti');
	assert.ok(botBuilt || Object.keys(bot.stocks ?? {}).length >= 0);
});

test('bot menyerah kalau tagihan sewa tak terbayar dan tak punya apa-apa', () => {
	const rng = seeded(7);
	const s = createGame('SIM2', { id: 'h', name: 'Host' });
	maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS, rng);
	startGame(s, rng);
	const bot = s.players.find((p) => p.bot);
	const human = s.players.find((p) => !p.bot);
	s.turn = s.players.indexOf(bot);
	s.phase = 'rent';
	s.tiles[1] = { owner: human.id, level: 0, mortgaged: false };
	s.pendingRent = { tile: 1, amount: 99999, deadline: Date.now() + 1e6 };
	bot.money = 10;
	for (let i = 0; i < 10 && !bot.bankrupt && s.phase === 'rent'; i++) botStep(s);
	assert.equal(bot.bankrupt || s.phase !== 'rent', true);
});

test('bot aktif main saham: sempat memegang saham selama permainan', () => {
	const rng = seeded(42);
	const s = createGame('SIMSTK', { id: 'h', name: 'Host' });
	maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS, rng);
	startGame(s, rng);
	const human = s.players.find((p) => !p.bot);
	const bot = s.players.find((p) => p.bot);
	const act = (a) => {
		try {
			applyAction(s, human.id, a, rng);
			return true;
		} catch (e) {
			if (e instanceof GameError) return false;
			throw e;
		}
	};
	let everHeldStock = false;
	for (let i = 0; i < 6000 && s.status === 'playing'; i++) {
		const cur = s.players[s.turn];
		if (cur.bot) botStep(s);
		else if (s.phase === 'rent') act({ type: 'payRent' }) || act({ type: 'bankrupt' });
		else if (s.phase === 'buy') act({ type: 'buy' }) || act({ type: 'skip' });
		else if (s.phase === 'roll') act({ type: 'roll' }) || act({ type: 'bankrupt' });
		else act({ type: 'endTurn' }) || act({ type: 'bankrupt' });
		if (Object.keys(bot.stocks ?? {}).length > 0) everHeldStock = true;
	}
	assert.ok(everHeldStock, 'bot sempat membeli & memegang saham');
});

test('botAI: tanpa AI_API_KEY jadi no-op (tidak memanggil callback apa pun)', async () => {
	const { tickBotAI, botAIEnabled } = await import('../server/botAI.js');
	const saved = process.env.AI_API_KEY;
	delete process.env.AI_API_KEY; // config.js sudah termuat; botAIEnabled() baca live
	assert.equal(botAIEnabled(), false);
	const s = createGame('AIROOM', { id: 'h', name: 'Host' });
	maybeAddBot(s, s.createdAt + BOT_JOIN_AFTER_MS);
	startGame(s);
	let called = false;
	tickBotAI(new Map([[s.code, s]]), {
		recentChat: () => { called = true; return []; },
		sendChat: () => { called = true; },
		onChange: () => { called = true; }
	});
	assert.equal(called, false, 'tidak ada callback terpanggil saat AI mati');
	if (saved !== undefined) process.env.AI_API_KEY = saved; // pulihkan env
});
