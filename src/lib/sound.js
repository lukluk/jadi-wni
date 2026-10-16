// Efek suara: Kenney.nl (CC0), lihat static/sounds/LICENSE-*.txt
import { browser } from '$app/environment';

/** volume per efek; positif = nada naik, negatif = nada turun/buzz */
const VOL = {
	dice: 0.6,
	step: 0.35,
	tick: 0.5,
	turn: 0.4,
	salary: 0.7,
	gain: 0.6,
	good: 0.6,
	earn: 0.6,
	sold: 0.6,
	build: 0.5,
	buy: 0.6,
	win: 0.7,
	bad: 0.6,
	tax: 0.6,
	pay: 0.6,
	reject: 0.5,
	bankrupt: 0.7,
	jail: 0.6,
	notif: 0.5,
	offer: 0.55,
	ping: 0.6
};

/** @typedef {keyof typeof VOL} Sfx */

const cache = new Map();
let muted = false;
if (browser) {
	try {
		muted = localStorage.getItem('jw-muted') === '1';
	} catch {
		/* storage diblokir */
	}
}

export const isMuted = () => muted;

export function setMuted(v) {
	muted = v;
	try {
		localStorage.setItem('jw-muted', v ? '1' : '0');
	} catch {
		/* abaikan */
	}
}

/** @param {Sfx} name */
export function play(name) {
	if (!browser || muted || !(name in VOL)) return;
	let base = cache.get(name);
	if (!base) {
		base = new Audio(`/sounds/${name}.mp3`);
		base.preload = 'auto';
		cache.set(name, base);
	}
	const a = /** @type {HTMLAudioElement} */ (base.cloneNode());
	a.volume = VOL[name];
	a.play().catch(() => {}); // diblokir sebelum ada interaksi pertama
}
