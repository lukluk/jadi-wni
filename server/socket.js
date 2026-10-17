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
	expireRent,
	expireKick,
	expireAd,
	knockoutTick,
	publicState,
	GameError
} from './game/engine.js';
import { TOKENS } from '../src/lib/shared/board.js';
import { refreshCityImages } from './cityImages.js';
import { refreshTileLogos } from './tileLogos.js';
import { autopilotStep } from './autopilot.js';
import { botStep, maybeAddBot } from './bot.js';
import { tickNetizen, feedOf, netizenEnabled } from './netizen.js';
import { config } from './config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_LIMIT = 60;
/** id proses ini; client yang menyambung ulang ke id berbeda berarti server baru (deploy) -> muat ulang halaman */
const BOOT_ID = `${Date.now().toString(36)}${randomInt(1e6).toString(36)}`;

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
	const ids = [...(presence.get(code)?.entries() ?? [])].filter(([, n]) => n > 0).map(([id]) => id);
	// bot selalu dianggap online
	const bots = rooms.get(code)?.players.filter((p) => p.bot).map((p) => p.id) ?? [];
	return [...ids, ...bots];
}

function broadcast(io, state) {
	io.to(state.code).emit('room:state', { ...publicState(state), online: onlineIds(state.code), now: Date.now() });
}

const isAdmin = (user) => !!user?.email && user.email.toLowerCase() === config.adminEmail;

/** Ringkasan semua room aktif untuk halaman admin (hanya data yang perlu untuk memantau). */
function adminSnapshot() {
	return [...rooms.values()].map((s) => {
		const online = onlineIds(s.code);
		return {
			code: s.code,
			status: s.status,
			createdAt: s.createdAt,
			turnCount: s.turnCount ?? 0,
			kasNegara: s.kasNegara ?? 0,
			hostId: s.hostId,
			turnId: s.players[s.turn]?.id ?? null,
			winnerId: s.winner ?? null,
			online: online.length,
			players: s.players.map((p) => ({
				id: p.id,
				name: p.name,
				money: p.money,
				pos: p.pos,
				bankrupt: !!p.bankrupt,
				bot: !!p.bot,
				host: p.id === s.hostId,
				online: online.includes(p.id)
			}))
		};
	});
}

const ADMIN_ROOM = 'admin';
function adminPayload() {
	const list = adminSnapshot();
	return {
		now: Date.now(),
		rooms: list,
		totals: {
			rooms: list.length,
			lobby: list.filter((r) => r.status === 'lobby').length,
			playing: list.filter((r) => r.status === 'playing').length,
			ended: list.filter((r) => r.status === 'ended').length,
			players: list.reduce((n, r) => n + r.players.filter((p) => !p.bot).length, 0),
			bots: list.reduce((n, r) => n + r.players.filter((p) => p.bot).length, 0)
		}
	};
}

const voiceRoom = (code) => `voice:${code}`;
function voiceMembers(io, code) {
	const ids = [...(io.sockets.adapter.rooms.get(voiceRoom(code)) ?? [])].map((sid) => io.sockets.sockets.get(sid)?.data.user.id);
	return [...new Set(ids.filter(Boolean))];
}
const emitVoice = (io, code) => {
	io.to(code).emit('voice:members', voiceMembers(io, code));
	io.to(code).emit('voice:states', voiceStates(io, code));
};
/** status mic/kamera tiap anggota suara: userId -> { muted, cam } */
function voiceStates(io, code) {
	const out = {};
	for (const sid of io.sockets.adapter.rooms.get(voiceRoom(code)) ?? []) {
		const d = io.sockets.sockets.get(sid)?.data;
		if (d?.user) out[d.user.id] = d.vstate ?? { muted: false, cam: false };
	}
	return out;
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
	refreshTileLogos();

	// batas waktu tagihan sewa: habis = menyerah
	setInterval(() => {
		for (const state of rooms.values()) {
			try {
				if (state.paused) continue; // jeda host: hentikan semua batas waktu
				const hostHere = (presence.get(state.code)?.get(state.hostId) ?? 0) > 0;
				if ((hostHere && maybeAddBot(state)) | expireRent(state) | expireKick(state) | knockoutTick(state) | expireAd(state)) {
					persist(state);
					broadcast(io, state);
				}
			} catch (e) {
				console.error(e);
			}
		}
	}, 1000).unref?.();

	// auto-play AI: host yang mengaktifkannya dimainkan otomatis, satu langkah per detik
	setInterval(() => {
		for (const state of rooms.values()) {
			try {
				if (state.paused) continue; // jeda host: AI & bot berhenti
				if (autopilotStep(state) || botStep(state)) {
					persist(state);
					broadcast(io, state);
				}
			} catch (e) {
				console.error(e);
			}
		}
	}, 1200).unref?.();

	// netizen AI: tiap 5 menit komentar kondisi pemain (butuh AI_API_KEY)
	setInterval(() => tickNetizen(rooms, (code, feed) => io.to(code).emit('netizen:feed', feed)), 5000).unref?.();

	// admin: kirim ringkasan semua room ke yang sedang memantau (hanya kalau ada yang nonton)
	setInterval(() => {
		if (io.sockets.adapter.rooms.get(ADMIN_ROOM)?.size) io.to(ADMIN_ROOM).emit('admin:rooms', adminPayload());
	}, 1500).unref?.();

	io.use((socket, next) => {
		const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
		const user = getUserBySession(cookies.sid);
		if (!user) return next(new Error('unauthorized'));
		socket.data.user = user;
		next();
	});

	// SIGTERM (deploy): simpan semua room lalu keluar segera; client otomatis menyambung ulang
	const shutdown = () => {
		for (const state of rooms.values()) {
			try {
				persist(state);
			} catch (e) {
				console.error(e);
			}
		}
		process.exit(0);
	};
	process.once('SIGTERM', shutdown);
	process.once('SIGINT', shutdown);

	io.on('connection', (socket) => {
		const user = socket.data.user;
		socket.emit('server:boot', BOOT_ID);
		/** @type {string|null} */
		let joined = null;

		/** @type {string|null} room tempat socket ini ikut obrolan suara (WebRTC mesh; server hanya relay sinyal) */
		let inVoice = null;
		const leaveVoice = () => {
			if (!inVoice) return;
			const code = inVoice;
			inVoice = null;
			socket.leave(voiceRoom(code));
			socket.to(voiceRoom(code)).emit('voice:peer-left', { sid: socket.id });
			emitVoice(io, code);
		};

		const leaveCurrent = () => {
			leaveVoice();
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

		socket.on('room:create', (payload, ack) => {
			try {
				const code = genCode();
				const state = createGame(code, user, { knockout: !!payload?.knockout });
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
			socket.emit('netizen:feed', netizenEnabled() ? (feedOf(code) ?? { posts: [], at: 0, nextAt: 0 }) : null);
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

		socket.on('room:knockout', (payload, ack) =>
			mutate((state) => {
				if (state.hostId !== user.id) throw new GameError('Hanya host yang bisa mengubah pengaturan.');
				if (state.status !== 'lobby') throw new GameError('Game sudah dimulai.');
				state.knockout = !!payload?.on;
			}, ack)
		);

		// hitung mundur akhir giliran dari pemain yang sedang giliran, diteruskan ke yang lain (tidak dipersist)
		socket.on('turn:countdown', (n) => {
			const state = joined && rooms.get(joined);
			if (!state || state.status !== 'playing' || state.players[state.turn]?.id !== user.id) return;
			const v = n == null ? null : Math.min(3, Math.max(0, Math.floor(Number(n)) || 0));
			socket.to(joined).emit('turn:countdown', { id: user.id, n: v });
		});

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

		socket.on('voice:join', (_p, ack) => {
			const state = joined && rooms.get(joined);
			if (!state) return ack?.({ ok: false, error: 'Belum masuk room.' });
			if (!state.players.some((p) => p.id === user.id)) return ack?.({ ok: false, error: 'Hanya pemain yang bisa ikut suara.' });
			leaveVoice();
			const code = state.code;
			const peers = [...(io.sockets.adapter.rooms.get(voiceRoom(code)) ?? [])].map((sid) => ({
				sid,
				userId: io.sockets.sockets.get(sid)?.data.user.id
			}));
			socket.join(voiceRoom(code));
			inVoice = code;
			ack?.({ ok: true, peers });
			emitVoice(io, code);
		});

		// relay offer/answer/ICE antar peer di room suara yang sama
		socket.on('voice:signal', (msg) => {
			const to = msg?.to;
			if (!inVoice || typeof to !== 'string' || to === socket.id) return;
			if (!io.sockets.adapter.rooms.get(voiceRoom(inVoice))?.has(to)) return;
			io.to(to).emit('voice:signal', { from: socket.id, userId: user.id, data: msg.data });
		});

		// komponen Netizen baru mounting setelah join, jadi minta feed terkini sendiri
		socket.on('netizen:query', (_p, ack) =>
			ack?.(joined && netizenEnabled() ? (feedOf(joined) ?? { posts: [], at: 0, nextAt: 0 }) : null)
		);

		socket.on('voice:leave', leaveVoice);
		socket.on('voice:state', (msg) => {
			if (!inVoice) return;
			socket.data.vstate = { muted: !!msg?.muted, cam: !!msg?.cam };
			io.to(joined).emit('voice:states', voiceStates(io, inVoice));
		});
		// host boleh mematikan mic/kamera pemain lain (menyalakan kembali tetap oleh pemilik)
		socket.on('voice:control', (msg) => {
			const state = joined && rooms.get(joined);
			if (!state || state.hostId !== user.id || !inVoice) return;
			if (msg?.kind !== 'mic' && msg?.kind !== 'cam') return;
			for (const sid of io.sockets.adapter.rooms.get(voiceRoom(inVoice)) ?? []) {
				if (io.sockets.sockets.get(sid)?.data.user.id === msg.userId) io.to(sid).emit('voice:control', { kind: msg.kind });
			}
		});
		socket.on('voice:query', (_p, ack) =>
			ack?.({ members: joined ? voiceMembers(io, joined) : [], states: joined ? voiceStates(io, joined) : {} })
		);

		// admin: pantau semua room (khusus akun admin; dicek ulang di server, bukan cuma di client)
		socket.on('admin:subscribe', (_p, ack) => {
			if (!isAdmin(user)) return ack?.({ ok: false, error: 'Khusus admin.' });
			socket.join(ADMIN_ROOM);
			ack?.({ ok: true, ...adminPayload() });
		});
		socket.on('admin:unsubscribe', () => socket.leave(ADMIN_ROOM));

		socket.on('disconnect', leaveCurrent);
	});

	return io;
}
