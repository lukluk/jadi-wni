import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Pasang Socket.IO ke dev server Vite (di production dipasang oleh server.js) */
const socketDev = {
	name: 'jadi-wni-socket',
	async configureServer(server) {
		if (!server.httpServer) return;
		const { attachSocket } = await import('./server/socket.js');
		attachSocket(server.httpServer);
	}
};

export default defineConfig({
	plugins: [sveltekit(), socketDev],
	ssr: { external: ['node:sqlite'] }
});
