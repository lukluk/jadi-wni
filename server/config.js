import { existsSync } from 'node:fs';

// Muat .env sekali untuk kode server murni (socket, db). SvelteKit memuat .env sendiri.
if (existsSync('.env') && !process.env.__JADI_WNI_ENV) {
	try {
		process.loadEnvFile('.env');
	} catch {
		/* abaikan */
	}
	process.env.__JADI_WNI_ENV = '1';
}

export const config = {
	dbPath: process.env.DB_PATH || './data/app.db',
	googleClientId: process.env.GOOGLE_CLIENT_ID || '',
	googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
	origin: process.env.ORIGIN || 'http://localhost:5173',
	allowDevLogin: process.env.ALLOW_DEV_LOGIN === 'true'
};
