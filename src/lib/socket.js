import { io } from 'socket.io-client';

/** @type {import('socket.io-client').Socket | null} */
let socket = null;

let bootId = null;

export function getSocket() {
	if (!socket) {
		socket = io({ path: '/socket.io', withCredentials: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
		// server dimatikan dengan sengaja tidak disambung ulang otomatis oleh socket.io; paksa
		socket.on('disconnect', (reason) => {
			if (reason === 'io server disconnect') socket?.connect();
		});
		// server baru (deploy ulang): muat ulang halaman supaya JS-nya ikut versi terbaru
		socket.on('server:boot', (id) => {
			if (bootId && bootId !== id) {
				location.reload();
				return;
			}
			bootId = id;
		});
	}
	return socket;
}

/** emit dengan ack berbentuk Promise */
export function call(event, payload = {}) {
	return new Promise((resolve) => {
		getSocket()
			.timeout(8000)
			.emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'Server tidak merespons.' } : res));
	});
}
