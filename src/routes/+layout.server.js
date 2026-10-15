import { config } from '../../server/config.js';

export function load({ locals }) {
	return {
		user: locals.user,
		googleEnabled: !!(config.googleClientId && config.googleClientSecret),
		devLogin: config.allowDevLogin
	};
}
