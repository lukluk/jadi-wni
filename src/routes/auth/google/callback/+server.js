import { redirect, error } from '@sveltejs/kit';
import { decodeIdToken } from 'arctic';
import { google, startSession, safeRedirect } from '$lib/server/auth.js';
import { upsertGoogleUser } from '../../../../../server/db.js';

export async function GET({ url, cookies }) {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get('g_state');
	const verifier = cookies.get('g_verifier');
	const next = safeRedirect(cookies.get('g_next'));
	for (const c of ['g_state', 'g_verifier', 'g_next']) cookies.delete(c, { path: '/' });

	if (!code || !state || !verifier || state !== storedState) error(400, 'Login Google tidak valid, coba lagi.');

	let claims;
	try {
		const tokens = await google().validateAuthorizationCode(code, verifier);
		claims = /** @type {any} */ (decodeIdToken(tokens.idToken()));
	} catch (e) {
		console.error('Google OAuth gagal', e);
		error(400, 'Gagal verifikasi login Google.');
	}

	const userId = upsertGoogleUser({
		sub: claims.sub,
		email: claims.email,
		name: claims.name || claims.email?.split('@')[0] || 'WNI',
		picture: claims.picture
	});
	startSession(cookies, userId, url);
	redirect(302, next);
}
