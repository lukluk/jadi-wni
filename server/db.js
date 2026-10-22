import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { PLACE_POINTS, PARTICIPATION_POINTS } from '../src/lib/shared/board.js';

const SESSION_DAYS = 30;

/** @type {DatabaseSync | undefined} */
let db;

export function getDb() {
	if (db) return db;
	mkdirSync(dirname(config.dbPath), { recursive: true });
	db = new DatabaseSync(config.dbPath);
	db.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA busy_timeout = 3000;
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			google_sub TEXT UNIQUE,
			email TEXT,
			name TEXT NOT NULL,
			avatar TEXT,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			expires_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS rooms (
			code TEXT PRIMARY KEY,
			host_id TEXT NOT NULL,
			state TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS stats (
			user_id TEXT PRIMARY KEY,
			games INTEGER NOT NULL DEFAULT 0,
			wins INTEGER NOT NULL DEFAULT 0,
			points INTEGER NOT NULL DEFAULT 0,
			best_networth INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		);
	`);
	return db;
}

const newId = (bytes = 16) => randomBytes(bytes).toString('base64url');

/**
 * @param {{ sub: string, email?: string, name: string, picture?: string }} p
 */
export function upsertGoogleUser(p) {
	const d = getDb();
	const existing = d.prepare('SELECT id FROM users WHERE google_sub = ?').get(p.sub);
	if (existing) {
		d.prepare('UPDATE users SET email = ?, name = ?, avatar = ? WHERE id = ?').run(
			p.email ?? null,
			p.name,
			p.picture ?? null,
			existing.id
		);
		return /** @type {string} */ (existing.id);
	}
	const id = newId(12);
	d.prepare(
		'INSERT INTO users (id, google_sub, email, name, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id, p.sub, p.email ?? null, p.name, p.picture ?? null, Date.now());
	return id;
}

/** Hanya untuk ALLOW_DEV_LOGIN */
export function createGuestUser(name) {
	const id = newId(12);
	getDb()
		.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)')
		.run(id, name, Date.now());
	return id;
}

export function createSession(userId) {
	const id = newId(32);
	const expiresAt = Date.now() + SESSION_DAYS * 864e5;
	getDb()
		.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
		.run(id, userId, expiresAt);
	return { id, expiresAt };
}

/** @returns {{ id: string, name: string, email: string|null, avatar: string|null } | null} */
export function getUserBySession(sessionId) {
	if (!sessionId) return null;
	const row = getDb()
		.prepare(
			`SELECT u.id, u.name, u.email, u.avatar, s.expires_at FROM sessions s
			 JOIN users u ON u.id = s.user_id WHERE s.id = ?`
		)
		.get(sessionId);
	if (!row) return null;
	if (row.expires_at < Date.now()) {
		deleteSession(sessionId);
		return null;
	}
	return { id: row.id, name: row.name, email: row.email, avatar: row.avatar };
}

export function deleteSession(sessionId) {
	getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function saveRoom(code, hostId, state) {
	getDb()
		.prepare(
			`INSERT INTO rooms (code, host_id, state, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(code) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
		)
		.run(code, hostId, JSON.stringify(state), Date.now());
}

export function loadRoom(code) {
	const row = getDb().prepare('SELECT state FROM rooms WHERE code = ?').get(code);
	return row ? JSON.parse(/** @type {string} */ (row.state)) : null;
}

export function roomExists(code) {
	return !!getDb().prepare('SELECT 1 FROM rooms WHERE code = ?').get(code);
}

// ---------- statistik & pangkat (ranked) ----------

/**
 * Catat hasil satu game selesai ke tabel stats. `standings` = hasil finalStandings()
 * (sudah urut juara di atas). Bot diabaikan; peringkat & poin dihitung di antara manusia.
 * @param {{id:string,bot:boolean,bankrupt:boolean,networth:number,winner:boolean}[]} standings
 */
export function recordGameResult(standings) {
	const humans = (standings ?? []).filter((s) => s && !s.bot && !String(s.id).startsWith('bot:'));
	if (!humans.length) return;
	const d = getDb();
	const now = Date.now();
	const stmt = d.prepare(
		`INSERT INTO stats (user_id, games, wins, points, best_networth, updated_at)
		 VALUES (?, 1, ?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   games = games + 1,
		   wins = wins + excluded.wins,
		   points = points + excluded.points,
		   best_networth = MAX(best_networth, excluded.best_networth),
		   updated_at = excluded.updated_at`
	);
	d.exec('BEGIN');
	try {
		humans.forEach((s, place) => {
			const pts = PLACE_POINTS[place] ?? PARTICIPATION_POINTS;
			stmt.run(s.id, s.winner ? 1 : 0, pts, Math.max(0, Math.trunc(s.networth || 0)), now);
		});
		d.exec('COMMIT');
	} catch (e) {
		d.exec('ROLLBACK');
		throw e;
	}
}

/** Papan peringkat: pemain teratas menurut poin (lalu kemenangan). Hanya user yang punya nama. */
export function topPlayers(limit = 20) {
	return getDb()
		.prepare(
			`SELECT u.id, u.name, u.avatar, s.games, s.wins, s.points, s.best_networth
			 FROM stats s JOIN users u ON u.id = s.user_id
			 ORDER BY s.points DESC, s.wins DESC, s.best_networth DESC
			 LIMIT ?`
		)
		.all(Math.max(1, Math.min(100, limit | 0)));
}

/** Statistik satu user (nilai default kalau belum pernah main). */
export function getUserStats(userId) {
	if (!userId) return null;
	const row = getDb()
		.prepare('SELECT games, wins, points, best_networth FROM stats WHERE user_id = ?')
		.get(userId);
	const base = row ?? { games: 0, wins: 0, points: 0, best_networth: 0 };
	// peringkat global (1-based) berdasarkan poin; null kalau belum punya poin
	const rank = base.points > 0
		? getDb().prepare('SELECT COUNT(*) AS n FROM stats WHERE points > ?').get(base.points).n + 1
		: null;
	return { ...base, globalRank: rank };
}
