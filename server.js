// Server production: SvelteKit (adapter-node) + Socket.IO di satu port.
import './server/config.js';
import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { attachSocket } from './server/socket.js';

const port = Number(process.env.PORT || 3000);
const server = createServer(handler);
attachSocket(server);
server.listen(port, () => console.log(`Jadi WNI jalan di http://localhost:${port}`));
