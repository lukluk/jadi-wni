import { json } from '@sveltejs/kit';
import { getTileLogos } from '../../../../server/tileLogos.js';

export function GET({ setHeaders }) {
	const logos = getTileLogos();
	// jangan cache hasil kosong (server baru start, logo belum selesai diunduh)
	setHeaders({ 'cache-control': Object.keys(logos).length ? 'public, max-age=3600' : 'no-store' });
	return json(logos);
}
