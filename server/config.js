import { existsSync } from 'node:fs';

// Muat .env sekali untuk kode server murni (socket, db). SvelteKit memuat .env sendiri.
if (!process.env.__JADI_WNI_ENV) {
	for (const f of ['.env', 'deploy/.env']) {
		if (!existsSync(f)) continue;
		try {
			process.loadEnvFile(f);
		} catch {
			/* abaikan */
		}
	}
	process.env.__JADI_WNI_ENV = '1';
}

export const config = {
	dbPath: process.env.DB_PATH || './data/app.db',
	googleClientId: process.env.GOOGLE_CLIENT_ID || '',
	googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
	origin: process.env.ORIGIN || 'http://localhost:5173',
	allowDevLogin: process.env.ALLOW_DEV_LOGIN === 'true',
	adminEmail: (process.env.ADMIN_EMAIL || 'luklukaha@gmail.com').toLowerCase()
};
