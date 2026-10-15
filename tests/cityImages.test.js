import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCityImages, WIKI_TITLES } from '../server/cityImages.js';
import { TILES } from '../src/lib/shared/board.js';

test('semua kota punya judul Wikipedia', () => {
	for (const t of TILES.filter((t) => t.type === 'property')) assert.ok(WIKI_TITLES[t.name], t.name);
});

test('parse respons Wikipedia + Commons (redirect, normalisasi, non-commons dibuang)', async () => {
	const fake = async (url) => {
		const u = new URL(url);
		assert.equal(u.searchParams.get('formatversion'), '2');
		if (u.hostname === 'en.wikipedia.org') {
			return Response.json({
				query: {
					normalized: [{ from: 'Kemang, Jakarta', to: 'Kemang, Jakarta' }],
					redirects: [{ from: 'BSD City', to: 'Bumi Serpong Damai' }],
					pages: [
						{ title: 'Bekasi', pageimage: 'Bekasi_skyline.jpg', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Bekasi_skyline.jpg/640px-Bekasi_skyline.jpg' } },
						{ title: 'Bumi Serpong Damai', pageimage: 'BSD.jpg', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/BSD.jpg/640px-BSD.jpg' } },
						{ title: 'Depok', pageimage: 'Local.jpg', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/x/xy/Local.jpg' } },
						{ title: 'Bogor' }
					]
				}
			});
		}
		return Response.json({
			query: {
				normalized: [{ from: 'File:Bekasi_skyline.jpg', to: 'File:Bekasi skyline.jpg' }],
				pages: [
					{ title: 'File:Bekasi skyline.jpg', imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Bekasi_skyline.jpg', extmetadata: { Artist: { value: '<a href="//x">Budi &amp; Siti</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
					{ title: 'File:BSD.jpg', imageinfo: [{ extmetadata: {} }] }
				]
			}
		});
	};
	const r = await fetchCityImages(fake);
	assert.deepEqual(Object.keys(r).sort(), ['BSD', 'Bekasi']);
	assert.equal(r.Bekasi.credit, 'Budi & Siti');
	assert.equal(r.Bekasi.license, 'CC BY-SA 4.0');
	assert.equal(r.Bekasi.page, 'https://commons.wikimedia.org/wiki/File:Bekasi_skyline.jpg');
	assert.equal(r.BSD.credit, 'Wikimedia Commons');
});
