import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { randomInt } from 'node:crypto';
import { getUserBySession, saveRoom, loadRoom, roomExists } from './db.js';
import {
	createGame,
	addPlayer,
	removePlayer,
	startGame,
	applyAction,
	forceSkip,
	publicState,
	GameError
} from './game/engine.js';
import { TOKENS } from '../src/lib/shared/board.js';
import { refreshCityImages } from './cityImages.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_LIMIT = 60;

/** @type {Map<string, any>} rooms aktif di memori (sumber kebenaran; disalin ke SQLite) */
const rooms = new Map();
/** @type {Map<string, Map<string, number>>} code -> userId -> jumlah socket terhubung */
const presence = new Map();
/** @type {Map<string, any[]>} chat per room (tidak dipersist) */
const chats = new Map();

function genCode() {
	for (;;) {
		let c = '';
		for (let i = 0; i < 6; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
		if (!rooms.has(c) && !roomExists(c)) return c;
	}
}

function getRoom(code) {
	if (rooms.has(code)) return rooms.get(code);
	const state = loadRoom(code);
	if (state && 'arisan' in state) {
		// migrasi room lama: Kas Arisan -> Kas Negara
		state.kasNegara = state.arisan;
		delete state.arisan;
	}
	if (state) rooms.set(code, state);
	return state;
}

const persist = (state) => saveRoom(state.code, state.hostId, state);

function onlineIds(code) {
	return [...(presence.get(code)?.entries() ?? [])].filter(([, n]) => n > 0).map(([id]) => id);
}

function broadcast(io, state) {
	io.to(state.code).emit('room:state', { ...publicState(state), online: onlineIds(state.code) });
}

function errMsg(e) {
	if (e instanceof GameError) return e.message;
	console.error(e);
	return 'Terjadi kesalahan server.';
}

/** @param {import('node:http').Server} httpServer */
export function attachSocket(httpServer) {
	const io = new Server(httpServer, { path: '/socket.io' });
	refreshCityImages();

	io.use((socket, next) => {
		const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
		const user = getUserBySession(cookies.sid);
		if (!user) return next(new Error('unauthorized'));
		socket.data.user = user;
		next();
	});

	io.on('connection', (socket) => {
		const user = socket.data.user;
		/** @type {string|null} */
		let joined = null;

		const leaveCurrent = () => {
			if (!joined) return;
			const code = joined;
			socket.leave(code);
			const pres = presence.get(code);
			if (pres) pres.set(user.id, Math.max(0, (pres.get(user.id) ?? 1) - 1));
			joined = null;
			const state = rooms.get(code);
			if (state) broadcast(io, state);
		};

		/** jalankan mutasi lalu broadcast + persist */
		const mutate = (fn, ack) => {
			const state = joined && rooms.get(joined);
			if (!state) return ack?.({ ok: false, error: 'Belum masuk room.' });
			try {
				fn(state);
				persist(state);
				broadcast(io, state);
				ack?.({ ok: true });
			} catch (e) {
				ack?.({ ok: false, error: errMsg(e) });
			}
		};

		socket.on('room:create', (_payload, ack) => {
			try {
				const code = genCode();
				const state = createGame(code, user);
				rooms.set(code, state);
				persist(state);
				ack?.({ ok: true, code });
			} catch (e) {
				ack?.({ ok: false, error: errMsg(e) });
			}
		});

		socket.on('room:join', (payload, ack) => {
			const code = String(payload?.code ?? '').toUpperCase().trim();
			const state = getRoom(code);
			if (!state) return ack?.({ ok: false, error: 'Room tidak ditemukan.' });
			const isPlayer = state.players.some((p) => p.id === user.id);
			if (!isPlayer && state.status === 'lobby') {
				try {
					addPlayer(state, user);
					persist(state);
				} catch (e) {
					return ack?.({ ok: false, error: errMsg(e) });
				}
			}
			if (joined !== code) {
				leaveCurrent();
				socket.join(code);
				joined = code;
				if (!presence.has(code)) presence.set(code, new Map());
				const pres = presence.get(code);
				pres.set(user.id, (pres.get(user.id) ?? 0) + 1);
			}
			ack?.({ ok: true, spectator: !state.players.some((p) => p.id === user.id), me: user });
			socket.emit('chat:history', chats.get(code) ?? []);
			broadcast(io, state);
		});

		socket.on('room:leave', (_p, ack) => {
			const state = joined && rooms.get(joined);
			if (state?.status === 'lobby') {
				try {
					removePlayer(state, user.id);
					persist(state);
				} catch (e) {
					return ack?.({ ok: false, error: errMsg(e) });
				}
			}
			leaveCurrent();
			ack?.({ ok: true });
		});

		socket.on('room:kick', (payload, ack) =>
			mutate((state) => {
				if (state.hostId !== user.id) throw new GameError('Hanya host yang bisa mengeluarkan pemain.');
				if (payload?.userId === user.id) throw new GameError('Tidak bisa mengeluarkan diri sendiri.');
				removePlayer(state, payload?.userId);
			}, ack)
		);

		socket.on('room:token', (payload, ack) =>
			mutate((state) => {
				if (state.status !== 'lobby') throw new GameError('Game sudah dimulai.');
				const token = TOKENS.find((t) => t.id === payload?.token);
				if (!token) throw new GameError('Bidak tidak dikenal.');
				if (state.players.some((p) => p.token === token.id && p.id !== user.id))
					throw new GameError('Bidak sudah dipakai pemain lain.');
				const me = state.players.find((p) => p.id === user.id);
				if (!me) throw new GameError('Kamu bukan pemain.');
				me.token = token.id;
			}, ack)
		);

		socket.on('game:start', (_p, ack) =>
			mutate((state) => {
				if (state.hostId !== user.id) throw new GameError('Hanya host yang bisa memulai.');
				startGame(state);
			}, ack)
		);

		socket.on('game:action', (action, ack) =>
			mutate((state) => applyAction(state, user.id, action), ack)
		);

		socket.on('game:skip', (_p, ack) =>
			mutate((state) => {
				const cur = state.players[state.turn];
				if (onlineIds(state.code).includes(cur.id))
					throw new GameError(`${cur.name} masih online, tunggu dia main.`);
				forceSkip(state, user.id);
			}, ack)
		);

		socket.on('chat', (payload) => {
			if (!joined) return;
			const text = String(payload?.text ?? '').trim().slice(0, 300);
			if (!text) return;
			const msg = { t: Date.now(), userId: user.id, name: user.name, text };
			const list = chats.get(joined) ?? [];
			list.push(msg);
			if (list.length > CHAT_LIMIT) list.shift();
			chats.set(joined, list);
			io.to(joined).emit('chat', msg);
		});

		socket.on('disconnect', leaveCurrent);
	});

	return io;
}
