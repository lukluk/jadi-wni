import { Google } from 'arctic';
import { config } from '../../../server/config.js';
import { createSession } from '../../../server/db.js';

/** @type {Google | null | undefined} */
let client;

export function google() {
	if (client !== undefined) return client;
	client =
		config.googleClientId && config.googleClientSecret
			? new Google(
					config.googleClientId,
					config.googleClientSecret,
					`${config.origin.replace(/\/$/, '')}/auth/google/callback`
				)
			: null;
	return client;
}

/** hanya izinkan path relatif di domain sendiri */
export function safeRedirect(next) {
	return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function startSession(cookies, userId, url) {
	const s = createSession(userId);
	cookies.set('sid', s.id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		expires: new Date(s.expiresAt)
	});
}
