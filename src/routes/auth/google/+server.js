import { redirect, error } from '@sveltejs/kit';
import { generateState, generateCodeVerifier } from 'arctic';
import { google, safeRedirect } from '$lib/server/auth.js';

export function GET({ cookies, url }) {
	const g = google();
	if (!g) error(500, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum diset.');
	const state = generateState();
	const codeVerifier = generateCodeVerifier();
	const authUrl = g.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);
	const opts = { path: '/', httpOnly: true, sameSite: /** @type {'lax'} */ ('lax'), maxAge: 600, secure: url.protocol === 'https:' };
	cookies.set('g_state', state, opts);
	cookies.set('g_verifier', codeVerifier, opts);
	cookies.set('g_next', safeRedirect(url.searchParams.get('next')), opts);
	redirect(302, authUrl.toString());
}
