import { topPlayers, getUserStats } from '../../server/db.js';

export function load({ locals }) {
	return {
		leaderboard: topPlayers(20),
		myStats: locals.user ? getUserStats(locals.user.id) : null
	};
}
