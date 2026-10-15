import '../server/config.js';
import { getUserBySession } from '../server/db.js';

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	event.locals.user = getUserBySession(event.cookies.get('sid'));
	return resolve(event);
}
