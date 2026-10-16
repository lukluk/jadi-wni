import { error } from '@sveltejs/kit';
import { config } from '../../../server/config.js';

export function load({ locals }) {
	const email = locals.user?.email?.toLowerCase();
	if (!email || email !== config.adminEmail) {
		error(403, 'Halaman ini khusus admin.');
	}
	return { me: locals.user };
}
