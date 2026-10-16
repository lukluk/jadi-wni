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

import { fetchTileLogos, LOGO_FILES } from '../server/tileLogos.js';

test('semua logo petak merujuk ke petak yang ada (stasiun, utilitas, atau pojok Bansos)', () => {
	for (const name of Object.keys(LOGO_FILES)) {
		const t = TILES.find((x) => x.name === name);
		assert.ok(t && ['station', 'utility', 'bansos'].includes(t.type), name);
	}
});

test('parse respons Commons untuk logo petak', async () => {
	const fake = async (url) => {
		assert.equal(new URL(url).hostname, 'commons.wikimedia.org');
		return Response.json({
			query: {
				pages: [
					{ title: 'File:Logo PLN.svg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/200px-Logo_PLN.svg.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Logo_PLN.svg', extmetadata: { Artist: { value: 'PLN' }, LicenseShortName: { value: 'Public domain' } } }] },
					{ title: 'File:TransJakarta Logo.svg', missing: true }
				]
			}
		});
	};
	const r = await fetchTileLogos(fake);
	assert.deepEqual(Object.keys(r), ['PLN']);
	assert.equal(r.PLN.license, 'Public domain');
	assert.equal(r.PLN.credit, 'PLN');
});
