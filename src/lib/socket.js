import { io } from 'socket.io-client';

/** @type {import('socket.io-client').Socket | null} */
let socket = null;

export function getSocket() {
	if (!socket) socket = io({ path: '/socket.io', withCredentials: true });
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
