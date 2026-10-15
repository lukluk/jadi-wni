import { redirect } from '@sveltejs/kit';
import { deleteSession } from '../../../../server/db.js';

export function POST({ cookies }) {
	const sid = cookies.get('sid');
	if (sid) deleteSession(sid);
	cookies.delete('sid', { path: '/' });
	redirect(303, '/');
}
