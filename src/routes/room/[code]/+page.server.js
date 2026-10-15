import { redirect } from '@sveltejs/kit';

export function load({ locals, params }) {
	if (!locals.user) redirect(302, `/?next=/room/${encodeURIComponent(params.code)}`);
	return { code: params.code.toUpperCase() };
}
