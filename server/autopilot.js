import { TILES, GROUPS, JAIL_FINE, maxLevelOf } from '../src/lib/shared/board.js';
import { applyAction, GameError } from './game/engine.js';

/** Cadangan kas yang dijaga autopilot agar tidak langsung kena sewa lalu bangkrut. */
const RESERVE = 300;

const tryAct = (state, id, action) => {
	try {
		applyAction(state, id, action);
		return true;
	} catch (e) {
		if (e instanceof GameError) return false;
		throw e;
	}
};

/**
 * Satu langkah autopilot untuk pemain yang sedang giliran (dipakai host: state.autoPlay).
 * @returns {boolean} true kalau state berubah
 */
export function autopilotStep(state) {
	if (state.status !== 'playing' || !state.autoPlay) return false;
	const p = state.players[state.turn];
	if (!p || p.id !== state.hostId || p.bankrupt) return false;
	const act = (a) => tryAct(state, p.id, a);

	if (state.phase === 'rent') return act({ type: 'payRent' }) || act({ type: 'bankrupt' });

	if (state.phase === 'buy') {
		const price = TILES[state.pendingBuy].price;
		return p.money - price >= RESERVE ? act({ type: 'buy' }) || act({ type: 'skip' }) : act({ type: 'skip' });
	}

	if (state.phase === 'roll') {
		if (p.money < 0) return act({ type: 'bankrupt' });
		if (p.inJail) {
			if (p.jailFree > 0 && act({ type: 'useJailFree' })) return true;
			if (p.money - JAIL_FINE >= RESERVE && act({ type: 'payJail' })) return true;
		}
		return act({ type: 'roll' });
	}

	if (state.phase === 'end') {
		if (p.money < 0) return act({ type: 'bankrupt' });
		// bangun rumah di properti sendiri selama kas masih aman
		for (const [i, t] of Object.entries(state.tiles)) {
			const tile = TILES[i];
			if (t.owner !== p.id || tile.type !== 'property' || t.mortgaged || t.level >= maxLevelOf(tile)) continue;
			if (p.money - GROUPS[tile.group].houseCost * 3 < RESERVE) continue;
			if (act({ type: 'build', tile: +i })) return true;
		}
		return act({ type: 'endTurn' });
	}
	return false;
}
