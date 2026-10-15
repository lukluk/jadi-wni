import { json } from '@sveltejs/kit';
import { getCityImages } from '../../../../server/cityImages.js';

export function GET({ setHeaders }) {
	setHeaders({ 'cache-control': 'public, max-age=3600' });
	return json(getCityImages());
}
