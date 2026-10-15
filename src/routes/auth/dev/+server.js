import { redirect, error } from '@sveltejs/kit';
import { config } from '../../../../server/config.js';
import { createGuestUser } from '../../../../server/db.js';
import { startSession, safeRedirect } from '$lib/server/auth.js';

// Login tamu untuk testing lokal. Hanya aktif bila ALLOW_DEV_LOGIN=true.
export async function POST({ request, cookies, url }) {
	if (!config.allowDevLogin) error(404);
	const form = await request.formData();
	const name = String(form.get('name') ?? '').trim().slice(0, 30) || 'Tamu';
	startSession(cookies, createGuestUser(`${name} (tamu)`), url);
	redirect(303, safeRedirect(String(form.get('next') ?? '/')));
}
