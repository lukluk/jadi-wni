import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

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
