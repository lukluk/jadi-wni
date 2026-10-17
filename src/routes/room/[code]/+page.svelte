<script>
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getSocket, call } from '$lib/socket.js';
	import Board from '$lib/components/Board.svelte';
	import TileSheet from '$lib/components/TileSheet.svelte';
	import PlayerCard from '$lib/components/PlayerCard.svelte';
	import { play } from '$lib/sound.js';
	import Voice from '$lib/components/Voice.svelte';
	import Netizen from '$lib/components/Netizen.svelte';
	import Rules from '$lib/components/Rules.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Market from '$lib/components/Market.svelte';
	import Portfolio from '$lib/components/Portfolio.svelte';
	import SkyScene from '$lib/components/SkyScene.svelte';
	import {
		TILES,
		GROUPS,
		listingTile,
		HOUSE_LEVELS,
		JAIL_FINE,
		MIN_PLAYERS,
		MAX_PLAYERS,
		formatRp,
		richestId,
		netWorth,
		surrenderPlan,
		formatAmt,
		salaryFor,
		SLOT_SYMBOLS,
		AD_SKIP_COST
	} from '$lib/shared/board.js';

	let { data } = $props();
	const me = $derived(page.data.user);

	/** @type {any} */
	let game = $state(null);
	let joinError = $state('');
	let toast = $state('');
	let toastTimer;
	let selectedTile = $state(/** @type {number|null} */ (null));
	let tab = $state('portfolio');
	let showLog = $state(false);
	let logModalEl = $state(/** @type {HTMLElement|null} */ (null));
	let chat = $state(/** @type {any[]} */ ([]));
	let chatText = $state('');
	let unread = $state(0);
	let busy = $state(false);
	let connected = $state(true);
	let card = $state(/** @type {any} */ (null));
	let pendingCard = $state(/** @type {any} */ (null));
	let moving = $state(false);
	let speaking = $state(/** @type {Record<string, boolean>} */ ({}));
	let voiceMembers = $state(/** @type {string[]} */ ([]));
	let voiceStreams = $state(/** @type {Record<string, MediaStream>} */ ({}));
	let voiceStates = $state(/** @type {Record<string, {muted:boolean, cam:boolean}>} */ ({}));
	let voice = $state();
	let shown = $state(/** @type {Record<string, number>} */ ({}));

	// bidak lewat GAJIAN: PlayerCard menganimasikan gaji masuk selagi bidak berhenti
	let salary = $state(/** @type {{id:string, amount:number, n:number}|null} */ (null));
	let salaryN = 0;
	function onSalary(id) {
		play('salary');
		salary = { id, amount: salaryFor(game.tiles, id).amount, n: ++salaryN };
	}

	const CARD_DELAY_MS = 600;
	const MONEY_AFTER_CARD_MS = 1200;

	// saldo pemain baru berubah (dengan animasi) setelah bidak sampai dan kartu terlihat sebentar
	let cardFresh = $state(false);

	// judol slot: tiga gulungan berputar lalu berhenti satu-satu; saldo baru berubah setelah semuanya berhenti.
	// Dipetakan per pemain supaya beberapa animasi bisa jalan bersamaan tanpa saling menimpa.
	let juds = $state(/** @type {Record<string, any>} */ ({}));
	let lastJudolSeq = -1;
	/** @type {Record<string, any[]>} timer aktif per pemain */
	const judTimers = {};
	const REEL_STOP_MS = [900, 1500, 2100];
	function startJudol(j) {
		const pid = j.playerId;
		(judTimers[pid] ?? []).forEach(clearTimeout);
		(judTimers[pid] ?? []).forEach(clearInterval);
		juds[pid] = { ...j, done: false, reels: ['❔', '❔', '❔'], stopped: 0 };
		play('dice');
		const spin = setInterval(() => {
			const cur = juds[pid];
			if (!cur) return;
			cur.reels = cur.reels.map((r, i) =>
				i < cur.stopped ? j.reels[i] : SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
			);
		}, 70);
		judTimers[pid] = [
			spin,
			...REEL_STOP_MS.map((ms, i) =>
				setTimeout(() => {
					const cur = juds[pid];
					if (!cur) return;
					cur.stopped = i + 1;
					cur.reels = cur.reels.map((r, k) => (k <= i ? j.reels[k] : r));
					play('notif');
				}, ms)
			),
			setTimeout(() => {
				clearInterval(spin);
				const cur = juds[pid];
				if (cur) {
					cur.reels = [...j.reels];
					cur.done = true;
				}
				play(j.delta > 0 ? 'good' : j.delta < 0 ? 'bad' : 'notif');
				// kalah judod beruntun (3x+): vignette merah di layar pemain itu sendiri, makin merah makin sering kalah
				if (j.playerId === me?.id && j.delta < 0 && (j.streak ?? 0) >= 3) flashLose(j.streak);
			}, 2300),
			setTimeout(() => {
				delete juds[pid];
				delete judTimers[pid];
			}, 5300)
		];
	}
	/** true selama animasi judod pemain ini belum selesai (menahan saldo kartunya) */
	const judHold = (pid) => !!juds[pid] && !juds[pid].done;

	// efek layar: kalah judod beruntun -> vignette merah yang cepat memudar (~2 dtk)
	let loseFx = $state(/** @type {{ streak:number, n:number }|null} */ (null));
	let loseFxTimer;
	function flashLose(streak) {
		loseFx = { streak, n: (loseFx?.n ?? 0) + 1 };
		clearTimeout(loseFxTimer);
		loseFxTimer = setTimeout(() => (loseFx = null), 2000);
	}
	let freshTimer;
	const holdMoney = $derived(rolling || moving || !!pendingCard || cardFresh);

	// reaksi cepat (ketawa / sedih / tepuk tangan)
	const REACTIONS = [
		{ kind: 'ketawa', label: 'Ngakak', emoji: '🤣', gif: '/reactions/ketawa.gif', key: '.' },
		{ kind: 'sedih', label: 'Sedih banget', emoji: '😭', gif: '/reactions/sedih.gif', key: ',' },
		{ kind: 'tepuk', label: 'Tepuk tangan', emoji: '👏', gif: '/reactions/tepuk.gif', key: 'h' }
	];
	const REACTION_BY_KIND = Object.fromEntries(REACTIONS.map((r) => [r.kind, r]));
	let reactPop = $state(false);
	let reactSeq = 0;
	let reactions = $state(/** @type {any[]} */ ([]));
	function sendReaction(kind) {
		reactPop = false;
		if (!REACTION_BY_KIND[kind]) return;
		getSocket().emit('reaction', { kind });
	}
	function showReaction(r) {
		if (!REACTION_BY_KIND[r?.kind]) return;
		const uid = ++reactSeq;
		const x = Math.round((Math.random() - 0.5) * Math.min(560, (globalThis.innerWidth ?? 800) * 0.6));
		reactions = [...reactions, { ...r, uid, x }].slice(-8);
		setTimeout(() => (reactions = reactions.filter((v) => v.uid !== uid)), 3600);
	}

	// kartu baru muncul setelah dadu berhenti dan bidak sampai
	$effect(() => {
		if (!pendingCard || rolling || moving) return;
		const t = setTimeout(() => {
			card = pendingCard;
			play(pendingCard.deck === 'musibah' ? 'bad' : pendingCard.deck === 'tax' ? 'tax' : 'good');
			pendingCard = null;
			cardFresh = true;
			clearTimeout(freshTimer);
			freshTimer = setTimeout(() => (cardFresh = false), MONEY_AFTER_CARD_MS);
		}, CARD_DELAY_MS);
		return () => clearTimeout(t);
	});
	let lastCardSeq = -1;
	let logEl = $state();
	let cityImages = $state(/** @type {Record<string, any>} */ ({}));
	let tileLogos = $state(/** @type {Record<string, any>} */ ({}));
	let rolling = $state(false);
	let faces = $state([1, 1]);
	let lastRollSeq = -1;
	let rollTimer;
	let faceTimer;

	const ROLL_MS = 800;

	// ---- kabar Pasar: popup notif (fade otomatis), titik di tab, animasi kartu pindah tangan ----
	let notifs = $state(/** @type {{id:number,msg:string,kind:string,tile:number|null}[]}*/ ([]));
	let notifId = 0;
	let mkUnseen = $state(0);
	let lastMkSeq = -1;
	let flight = $state(/** @type {any} */ (null));

	function pushNotif(msg, kind, tile = null) {
		const id = ++notifId;
		notifs = [...notifs, { id, msg, kind, tile }].slice(-3);
		setTimeout(() => (notifs = notifs.filter((n) => n.id !== id)), 4200);
	}

	function onMarketEvent(ev, st) {
		const who = (id) => st.players.find((p) => p.id === id)?.name ?? 'Pemain';
		const t = listingTile(ev.tile).name;
		const mine = me?.id;
		let msg = '';
		let attention = false;
		if (ev.kind === 'list' || ev.kind === 'reprice') {
			if (ev.actor === mine) return;
			msg = `🏷️ ${who(ev.actor)} ${ev.kind === 'list' ? 'jual' : 'ubah harga'} ${t} · ${formatRp(ev.price)}`;
			attention = true;
		} else if (ev.kind === 'offer') {
			if (ev.target !== mine) return;
			msg = `💬 ${who(ev.actor)} menawar ${t} · ${formatRp(ev.price)}`;
			attention = true;
		} else if (ev.kind === 'reject') {
			if (ev.target !== mine) return;
			msg = `❌ ${who(ev.actor)} menolak tawaranmu untuk ${t}`;
			attention = true;
		} else if (ev.kind === 'sold') {
			msg = `🤝 ${who(ev.to)} beli ${t} dari ${who(ev.from)} · ${formatRp(ev.price)}`;
			attention = ev.from === mine || ev.to === mine;
			const n = ++notifId;
			flight = { ...ev, n };
			setTimeout(() => flight?.n === n && (flight = null), 1900);
		}
		if (!msg) return;
		play(ev.kind === 'sold' ? 'sold' : ev.kind === 'offer' ? 'offer' : ev.kind === 'reject' ? 'reject' : 'notif');
		pushNotif(msg, ev.kind);
		if (attention && tab !== 'market') mkUnseen += 1;
	}

	/** kartu terbang dari kartu penjual ke kartu pembeli */
	function fly(node, f) {
		const a = document.querySelector(`[data-pid="${CSS.escape(f.from)}"]`)?.getBoundingClientRect();
		const b = document.querySelector(`[data-pid="${CSS.escape(f.to)}"]`)?.getBoundingClientRect();
		const w = node.offsetWidth;
		const h = node.offsetHeight;
		const mid = (r) => (r ? [r.left + r.width / 2 - w / 2, r.top + r.height / 2 - h / 2] : [innerWidth / 2 - w / 2, innerHeight / 2 - h / 2]);
		const [x0, y0] = mid(a);
		const [x1, y1] = mid(b);
		node.style.left = '0px';
		node.style.top = '0px';
		const anim = node.animate(
			[
				{ transform: `translate(${x0}px,${y0}px) scale(.6) rotate(-6deg)`, opacity: 0 },
				{ transform: `translate(${x0}px,${y0}px) scale(1.05) rotate(-3deg)`, opacity: 1, offset: 0.2 },
				{ transform: `translate(${(x0 + x1) / 2}px,${(y0 + y1) / 2 - 60}px) scale(1.15) rotate(3deg)`, opacity: 1, offset: 0.55 },
				{ transform: `translate(${x1}px,${y1}px) scale(.9) rotate(0deg)`, opacity: 1, offset: 0.88 },
				{ transform: `translate(${x1}px,${y1}px) scale(.5)`, opacity: 0 }
			],
			{ duration: 1700, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' }
		);
		return { destroy: () => anim.cancel() };
	}

	function startRolling() {
		play('dice');
		clearInterval(faceTimer);
		clearTimeout(rollTimer);
		rolling = true;
		faceTimer = setInterval(() => {
			faces = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
		}, 80);
		rollTimer = setTimeout(() => {
			clearInterval(faceTimer);
			rolling = false;
		}, ROLL_MS);
	}

	const inviteUrl = $derived(`${page.url.origin}/room/${data.code}`);
	const myPlayer = $derived(game?.players.find((p) => p.id === me?.id));
	const isHost = $derived(game?.hostId === me?.id);
	// gabung di tengah permainan (perlu persetujuan host)
	const joinReqs = $derived(game?.joinRequests ?? []);
	const iRequestedJoin = $derived(joinReqs.some((r) => r.id === me?.id));
	const canRequestJoin = $derived(
		game?.status === 'playing' && !myPlayer && game.players.length < MAX_PLAYERS
	);
	const cur = $derived(game?.status === 'playing' ? game.players[game.turn] : null);
	const myTurn = $derived(!!cur && cur.id === me?.id);
	const curOnline = $derived(!!cur && game.online.includes(cur.id));
	const winner = $derived(game?.winner ? game.players.find((p) => p.id === game.winner) : null);
	/** jumlah tawaran masuk di asetku yang dijual */
	const marketBadge = $derived(
		Object.values(game?.market ?? {})
			.filter((l) => l.seller === me?.id)
			.reduce((n, l) => n + Object.keys(l.offers ?? {}).length, 0)
	);
	/** sewa yang menunggu persetujuan pemain yang sedang giliran */
	const rentInfo = $derived.by(() => {
		const r = game?.phase === 'rent' ? game.pendingRent : null;
		const own = r && game.tiles[r.tile];
		const owner = own && game.players.find((x) => x.id === own.owner);
		if (!r || !owner) return null;
		const tile = TILES[r.tile];
		const rent = formatRp(r.amount);
		const n = TILES.filter((t) => t.type === tile.type && game.tiles[t.i]?.owner === owner.id).length;
		let text;
		if (tile.type === 'station') text = `Kamu jalan-jalan naik ${tile.name} milik ${owner.name}, dengan total biaya ${rent}`;
		else if (tile.type === 'utility') text = `Kamu pakai ${tile.name} milik ${owner.name}, dengan total biaya ${rent}`;
		else if (own.level === 0) text = `Kamu jalan-jalan ke ${tile.name} punya ${owner.name} dengan total biaya ${rent}`;
		else text = `Kamu Staycation di ${tile.name} punya ${owner.name} dengan total biaya ${rent}`;
		const detail =
			tile.type === 'property' ? (own.level === 0 ? 'tidak menginap' : HOUSE_LEVELS[own.level].name) : `${owner.name} punya ${n} ${tile.type === 'station' ? 'stasiun' : 'utilitas'}: ${TILES.filter((t) => t.type === tile.type && game.tiles[t.i]?.owner === owner.id).map((t) => t.short ?? t.name).join(', ')}`;
		return { r, tile, owner, text, detail, title: tile.type === 'property' && own.level === 0 ? 'Tagihan' : 'Tagihan sewa', short: r.amount - (myPlayer?.money ?? 0) };
	});
	/** pemain hidup berikutnya setelah giliran ini */
	const nextPlayer = $derived.by(() => {
		if (!game) return null;
		for (let k = 1; k < game.players.length; k++) {
			const q = game.players[(game.turn + k) % game.players.length];
			if (!q.bankrupt) return q.id === me?.id ? null : q;
		}
		return null;
	});
	/** voting kick: 70% pemain lain harus setuju */
	const kv = $derived(game?.kickVote ?? null);
	const kvInfo = $derived.by(() => {
		if (!kv) return null;
		const target = game.players.find((x) => x.id === kv.target);
		const by = game.players.find((x) => x.id === kv.by);
		const voters = game.players.filter((x) => !x.bankrupt && x.id !== kv.target);
		const need = Math.ceil(voters.length * 0.7 - 1e-9);
		const yes = voters.filter((x) => kv.votes[x.id] === true).length;
		const no = voters.filter((x) => kv.votes[x.id] === false).length;
		const mine = me ? kv.votes[me.id] : undefined;
		const canVote = !!myPlayer && !myPlayer.bankrupt && myPlayer.id !== kv.target;
		const left = Math.max(0, Math.ceil((kv.deadline - (nowMs + clockOffset)) / 1000));
		return { target, by, voters: voters.length, need, yes, no, mine, canVote, left };
	});
	let lastKickKey = '';
	$effect(() => {
		const key = kv ? `${kv.target}:${kv.deadline}` : '';
		if (key && key !== lastKickKey) play('offer');
		lastKickKey = key;
	});
	const canStartKick = $derived(
		game?.status === 'playing' && !!myPlayer && !myPlayer.bankrupt && !kv && game.players.filter((x) => !x.bankrupt).length >= 3
	);

	const showRent = $derived(!!rentInfo && myTurn && !rolling && !moving);

	// aksi utama yang dipicu tombol Spasi (null = tidak ada aksi sekarang). Syaratnya menyamai tombol di layar.
	const spaceAct = $derived.by(() => {
		if (!game || game.status !== 'playing' || !myTurn || !myPlayer || busy || rolling || moving) return null;
		if (adBlocked) return null; // iklan menghalangi semua aksi
		if (showRent && rentInfo && rentInfo.short <= 0) return { type: 'payRent' };
		if (game.phase === 'roll' && myPlayer.money >= 0) return { type: 'roll' };
		if (game.phase === 'buy' && pendingTile && myPlayer.money >= pendingTile.price) return { type: 'buy' };
		if (game.phase === 'end' && myPlayer.money >= 0) return { type: 'endTurn' };
		return null;
	});
	function onHotkey(e) {
		if (e.key === 'Escape') {
			if (reactPop) { reactPop = false; return; }
			if (showLog) { showLog = false; return; }
		}
		const el = /** @type {HTMLElement|null} */ (document.activeElement);
		const typing =
			el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable;
		// reaksi cepat via hotkey (ketawa "." · sedih "," · tepuk tangan "h")
		if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && game && me) {
			const r = REACTIONS.find((x) => x.key === e.key);
			if (r) {
				e.preventDefault();
				sendReaction(r.kind);
				return;
			}
		}
		if (e.code !== 'Space' && e.key !== ' ') return;
		if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
		if (typing) return;
		const a = spaceAct;
		if (!a) return;
		e.preventDefault(); // cegah scroll & klik ganda pada tombol yang kebetulan fokus
		act(a);
	}

	// batas waktu tagihan (jam server dipakai supaya semua pemain melihat hitungan yang sama)
	const RENT_SECONDS = 120;
	let clockOffset = 0;
	let nowMs = $state(Date.now());
	$effect(() => {
		if (game?.phase !== 'rent' && !game?.kickVote && !game?.koWarnUntil && !game?.ad) return;
		const iv = setInterval(() => (nowMs = Date.now()), 250);
		return () => clearInterval(iv);
	});
	// iklan: hitung mundur & status "aku terganggu" / "iklanku tayang"
	const adLeft = $derived(
		game?.ad ? Math.max(0, Math.ceil((game.ad.deadline - (nowMs + clockOffset)) / 1000)) : 0
	);
	const adBlocked = $derived(
		!!game?.ad && adLeft > 0 && !!me && game.ad.by !== me.id && !game.ad.skipped.includes(me.id)
	);
	const adMine = $derived(!!game?.ad && adLeft > 0 && !!me && game.ad.by === me.id);
	const koLeft = $derived(
		game?.koWarnUntil ? Math.max(0, Math.ceil((game.koWarnUntil - (nowMs + clockOffset)) / 1000)) : 0
	);
	const koPoorest = $derived.by(() => {
		if (!game || game.status !== 'playing' || !game.koWarnUntil) return null;
		const alive = game.players.filter((p) => !p.bankrupt);
		if (!alive.length) return null;
		return alive
			.map((p) => ({ p, w: netWorth(game, p) }))
			.sort((a, b) => a.w - b.w || a.p.money - b.p.money)[0];
	});
	const rentLeft = $derived.by(() => {
		const dl = game?.phase === 'rent' ? game.pendingRent?.deadline : null;
		if (!dl) return null;
		return Math.max(0, Math.min(RENT_SECONDS, Math.ceil((dl - (nowMs + clockOffset)) / 1000)));
	});
	const fmtLeft = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
	const rentWait = $derived(rentInfo && rentLeft !== null && !rolling && !moving ? fmtLeft(rentLeft) : null);
	const pendingTile =$derived(game?.pendingBuy != null ? TILES[game.pendingBuy] : null);

	function showToast(msg) {
		toast = msg;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 3500);
	}

	async function join() {
		// server bisa masih bangun sesaat setelah deploy; coba lagi sebelum menyerah
		let res = await call('room:join', { code: data.code });
		for (let i = 0; i < 5 && !res.ok && res.error === 'Server tidak merespons.'; i++) {
			await new Promise((r) => setTimeout(r, 1500));
			res = await call('room:join', { code: data.code });
		}
		joinError = res.ok ? '' : res.error;
	}

	onMount(() => {
		fetch('/api/city-images')
			.then((r) => (r.ok ? r.json() : {}))
			.then((m) => (cityImages = m))
			.catch(() => {});
		fetch('/api/tile-logos')
			.then((r) => (r.ok ? r.json() : {}))
			.then((m) => (tileLogos = m))
			.catch(() => {});
		const s = getSocket();
		const onState = (st) => {
			if (lastJudolSeq === -1) lastJudolSeq = st.lastJudol?.seq ?? 0;
			else if (st.lastJudol && st.lastJudol.seq > lastJudolSeq) {
				lastJudolSeq = st.lastJudol.seq;
				startJudol(st.lastJudol);
			}
			if (lastCardSeq === -1) lastCardSeq = st.lastCard?.seq ?? 0;
			else if (st.lastCard && st.lastCard.seq > lastCardSeq) {
				lastCardSeq = st.lastCard.seq;
				pendingCard = st.lastCard;
			}
			const mk = st.mkEvent;
			if (lastMkSeq === -1) lastMkSeq = mk?.seq ?? 0;
			else if (mk && mk.seq > lastMkSeq) {
				lastMkSeq = mk.seq;
				onMarketEvent(mk, st);
			}
			const rs = st.rollSeq ?? 0;
			if (lastRollSeq !== -1 && rs > lastRollSeq) startRolling();
			lastRollSeq = rs;
			if (st.now) clockOffset = st.now - Date.now();
			if (game && st.turn !== game.turn) remote = null;
			stateSounds(game, st);
			game = st;
		};
		const onChat = (m) => {
			chat = [...chat, m].slice(-60);
			if (tab !== 'chat') unread += 1;
		};
		const onHistory = (h) => (chat = h);
		const onConnect = () => {
			connected = true;
			join();
		};
		const onDisconnect = () => (connected = false);
		const onConnectError = (e) => {
			if (e.message === 'unauthorized') goto(`/?next=/room/${data.code}`);
		};
		s.on('room:state', onState);
		s.on('chat', onChat);
		s.on('chat:history', onHistory);
		s.on('reaction', showReaction);
		const onRemoteCount = (m) => {
			remote = m.n ? m : null;
			if (m.n) play('tick');
		};
		s.on('turn:countdown', onRemoteCount);
		s.on('connect', onConnect);
		s.on('disconnect', onDisconnect);
		s.on('connect_error', onConnectError);
		window.addEventListener('keydown', onHotkey);
		if (s.connected) join();
		return () => {
			window.removeEventListener('keydown', onHotkey);
			clearInterval(faceTimer);
			clearTimeout(rollTimer);
			s.off('room:state', onState);
			s.off('chat', onChat);
			s.off('chat:history', onHistory);
			s.off('reaction', showReaction);
			s.off('turn:countdown', onRemoteCount);
			s.off('connect', onConnect);
			s.off('disconnect', onDisconnect);
			s.off('connect_error', onConnectError);
		};
	});

	$effect(() => {
		// auto-scroll obrolan
		chat.length;
		tab;
		if (tab === 'chat') tick().then(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
	});
	$effect(() => {
		// auto-scroll modal kejadian ke bawah saat dibuka / ada kejadian baru
		game?.log.length;
		if (showLog) tick().then(() => logModalEl && (logModalEl.scrollTop = logModalEl.scrollHeight));
	});

	$effect(() => {
		if (!card) return;
		const t = setTimeout(() => (card = null), 6000);
		return () => clearTimeout(t);
	});

	async function emit(event, payload) {
		busy = true;
		const res = await call(event, payload);
		busy = false;
		if (!res.ok) showToast(res.error);
		return res;
	}
	const act = async (a) => {
		const res = await emit('game:action', a);
		if (res?.ok) {
			if (a.type === 'stockBuy') play('buy');
			else if (a.type === 'stockSell') play('earn');
		}
		return res;
	};

	$effect(() => {
		if (countdown) play('tick');
	});

	// hitung mundur pemain yang giliran juga terlihat pemain lain
	let remote = $state(/** @type {{id:string,n:number|null}|null} */ (null));
	$effect(() => {
		const n = countdown;
		if (!myTurn && n === null) return;
		getSocket().emit('turn:countdown', n);
	});

	/** bandingkan state lama dan baru untuk memutar suara event */
	function stateSounds(prev, st) {
		if (!prev || prev.status !== 'playing' && st.status !== 'ended') return;
		const myId = me?.id;
		if (prev.phase === 'rent' && st.phase !== 'rent' && prev.pendingRent) {
			const payer = prev.players[prev.turn];
			if (payer.id === myId) play('pay');
			else if (prev.tiles[prev.pendingRent.tile]?.owner === myId) play('earn');
		}
		// pemain mana pun beli properti / bangun rumah: notif di web + nada notif HP
		const nm = (id) => st.players.find((x) => x.id === id)?.name ?? 'Pemain';
		let pinged = false;
		for (const [i, t] of Object.entries(st.tiles)) {
			const before = prev.tiles[i];
			const tile = TILES[+i];
			if (!before && prev.pendingBuy === +i) {
				pushNotif(`🏠 ${nm(t.owner)} beli ${tile.name} · ${formatRp(tile.price)}`, 'buy', +i);
				pinged = true;
			} else if (before && t.level > before.level) {
				pushNotif(`🔨 ${nm(t.owner)} bangun ${HOUSE_LEVELS[t.level].name} di ${tile.name}`, 'build', +i);
				pinged = true;
			}
		}
		if (pinged) play('ping');
		if (st.players.some((p, i) => p.bankrupt && !prev.players[i]?.bankrupt)) play('bankrupt');
		else if (st.players.some((p, i) => p.inJail && prev.players[i] && !prev.players[i].inJail)) play('jail');
		if (st.status === 'playing' && st.turn !== prev.turn && st.players[st.turn].id === myId) play('turn');
		if (prev.status === 'playing' && st.status === 'ended') play(st.winner === myId ? 'win' : 'bad');
	}

	// giliran berakhir otomatis 3-2-1 setelah dadu, bidak, dan kartu selesai
	let countdown = $state(/** @type {number|null} */ (null));
	$effect(() => {
		const ready =
			myTurn && game.phase === 'end' && myPlayer.money >= 0 && !rolling && !moving && !card && !pendingCard && !game.paused;
		if (!ready) {
			countdown = null;
			return;
		}
		countdown = 3;
		const iv = setInterval(() => {
			if (countdown && countdown > 1) countdown -= 1;
			else {
				clearInterval(iv);
				countdown = null;
				act({ type: 'endTurn' });
			}
		}, 1000);
		return () => clearInterval(iv);
	});

	async function copyInvite() {
		try {
			await navigator.clipboard.writeText(inviteUrl);
			showToast('Link undangan disalin.');
		} catch {
			showToast(inviteUrl);
		}
	}
	async function shareInvite() {
		const text = `Ayo main Jadi WNI bareng! Kode room: ${data.code}`;
		if (navigator.share) {
			try {
				await navigator.share({ title: 'Jadi WNI', text, url: inviteUrl });
			} catch {
				/* dibatalkan */
			}
		} else copyInvite();
	}
	const waLink = $derived(
		`https://wa.me/?text=${encodeURIComponent(`Ayo main Jadi WNI bareng! ${inviteUrl}`)}`
	);

	async function leave() {
		await call('room:leave');
		goto('/');
	}

	async function newRoom() {
		const res = await call('room:create');
		if (res.ok) location.href = `/room/${res.code}`;
	}

	/** menyerah: tampilkan perkiraan hasil penjualan otomatis aset sebelum konfirmasi */
	function surrender() {
		if (!myPlayer) return;
		const pl = surrenderPlan(game, myPlayer);
		const row = (label, v) => (v ? `${label}: ${formatRp(v)}\n` : '');
		const head =
			pl.outcome === 'keluar'
				? 'Menyerah = keluar dari game. Semua asetmu disita bank.\n\n'
				: 'Menyerah: semua asetmu dijual otomatis untuk menutup kekuranganmu.\n\n';
		const est =
			`Perkiraan:\n` +
			row('• Saldo', pl.money) +
			row('• Properti (harga beli)', pl.properties) +
			row('• Bangunan (harga jual)', pl.buildings) +
			row('• Saham (harga sekarang)', pl.stocks) +
			row('• Tagihan sewa', -pl.rent) +
			`= Sisa ${formatRp(pl.left)}\n\n`;
		const tail =
			pl.outcome === 'lanjut'
				? 'Sisa di atas 0: kamu LANJUT main hanya dengan uang sisa (tanpa aset).'
				: pl.outcome === 'bangkrut'
					? 'Sisa 0 atau kurang: kamu RUNGKAT.' + (pl.creditorId ? ' Aset sisa jadi milik penagih.' : '')
					: '';
		confirmAct(head + (pl.outcome === 'keluar' ? '' : est) + tail + (pl.outcome === 'keluar' ? '' : '\n\nIni perkiraan; angka final dihitung server.') + '\n\nLanjut menyerah?', { type: 'bankrupt' });
	}

	function confirmAct(msg, a) {
		if (confirm(msg)) act(a);
	}

	function sendChat(e) {
		e.preventDefault();
		const text = chatText.trim();
		if (!text) return;
		getSocket().emit('chat', { text });
		chatText = '';
	}

	const fmtTime = (t) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head>
	<title>Room {data.code} · Jadi WNI</title>
</svelte:head>

{#if !connected}<span class="offline" role="status">Menyambung ulang…</span>{/if}

{#if joinError}
	<main class="center-msg">
		<h1>Tidak bisa masuk room</h1>
		<p>{joinError}</p>
		<a class="btn primary" href="/">Kembali ke beranda</a>
	</main>
{:else if !game}
	<main class="center-msg"><p>Menyiapkan room…</p></main>
{:else if game.status === 'lobby'}
	<SkyScene />
	<main class="lobby">
		<section class="invite">
			<span class="room-badge">Room <b>{data.code}</b></span>
			<h1>Ajak teman main</h1>
			<p>Kirim link ini. Siapa pun yang punya link bisa masuk setelah login Google.</p>
			<div class="link-row">
				<input readonly value={inviteUrl} onfocus={(e) => e.currentTarget.select()} aria-label="Link undangan" />
				<button class="btn" onclick={copyInvite}>Salin</button>
			</div>
			<div class="share">
				<a class="btn yellow" href={waLink} target="_blank" rel="noopener">Kirim via WhatsApp</a>
				<button class="btn" onclick={shareInvite}>Bagikan…</button>
			</div>
		</section>

		<section class="players">
			<h2>Pemain {game.players.length}/{MAX_PLAYERS}</h2>
			<div class="plist">
				{#each game.players as p (p.id)}
					<div class="prow">
						<PlayerCard
							{p}
							{game}
							isTurn={false}
							isMe={p.id === me?.id}
							online={game.online.includes(p.id)}
							isHost={p.id === game.hostId}
							roomCode={data.code}
							onCopyCode={copyInvite}
							speaking={!!speaking[p.id]}
							inVoice={voiceMembers.includes(p.id)}
							stream={voiceStreams[p.id] ?? null}
							micMuted={!!voiceStates[p.id]?.muted}
							camOn={!!voiceStates[p.id]?.cam}
							canControl={p.id === me?.id || isHost}
							onControl={(k) => voice?.control(p.id, k)}
						/>
						{#if isHost && p.id !== me?.id}
							<button class="kick" onclick={() => emit('room:kick', { userId: p.id })} aria-label={`Keluarkan ${p.name}`}>✕</button>
						{/if}
					</div>
				{/each}
			</div>

			{#if !myPlayer}
				<p>Kamu menonton room ini.</p>
			{/if}

			{#if isHost}
				<label class="ko-opt">
					<input type="checkbox" checked={!!game.knockout} onchange={(e) => emit('room:knockout', { on: e.currentTarget.checked })} />
					<span><b>☠️ Knock Out</b> — tiap 20 menit pemain termiskin tereliminasi (ada peringatan 3 menit untuk jual aset).</span>
				</label>
			{:else if game.knockout}
				<p class="ko-note"><b>☠️ Mode Knock Out aktif.</b> Tiap 20 menit pemain termiskin tereliminasi — ada 3 menit untuk menyelamatkan diri.</p>
			{/if}

			<div class="lobby-actions">
				{#if isHost}
					<button class="btn primary" disabled={busy || game.players.length < MIN_PLAYERS} onclick={() => emit('game:start')}>
						Mulai game
					</button>
					{#if game.players.length < MIN_PLAYERS}<small>Butuh minimal {MIN_PLAYERS} pemain.</small>{/if}
				{:else}
					<div class="wait">
						<span class="dice-spin" aria-hidden="true">🎲</span>
						<div>
							<strong>Menunggu host memulai…</strong>
							<small>Santai dulu, sebentar lagi mulai. <span class="dots"><i>.</i><i>.</i><i>.</i></span></small>
						</div>
					</div>
				{/if}
				<button class="btn small" onclick={leave}>Keluar room</button>
			</div>
		</section>
	</main>
{:else}
	<main class="game">
		<div class="board-wrap">
			<Board {game} meId={me?.id ?? null} images={cityImages} logos={tileLogos} {rolling} bind:moving bind:shown {onSalary} onTile={(i) => (selectedTile = i)} onBuild={(i) => act({ type: 'build', tile: i })}>
				{#snippet center()}
					<div class="hub">
						<div class="decks">
							<div class="deck musibah">Musibah</div>
							<div class="kas-col">
								<Rules />
								<div class="kas">
									<small>🏛️ Kas Negara</small>
									<strong>{formatRp(game.kasNegara)}</strong>
								</div>
							</div>
							<div class="deck takdir">Takdir</div>
						</div>

						{#if game.dice}
							<div class="dice" class:rolling aria-label={`Dadu ${game.dice[0]} dan ${game.dice[1]}`}>
								<span class="die">{rolling ? faces[0] : game.dice[0]}</span><span class="die">{rolling ? faces[1] : game.dice[1]}</span>
							</div>
						{/if}

						{#if game.status === 'ended'}
							<div class="ended">
								<h2>🏆 {winner?.name ?? '—'}</h2>
								<p>Jadi WNI paling sukses.</p>
								<button class="btn primary" onclick={newRoom}>Main lagi (room baru)</button>
							</div>
						{:else if myTurn}
							{#if game.phase === 'end' && countdown && nextPlayer}
								<p class="turn-label">Giliran <span style:color={nextPlayer.color}>{nextPlayer.name}</span></p>
							{:else}
								<p class="turn-label">Giliranmu!</p>
							{/if}
							{#if myPlayer.money < 0}
								<p class="debt">Saldo minus {formatRp(myPlayer.money)}. Jual rumah atau gadai aset (klik petakmu), atau nyatakan rungkat.</p>
							{/if}
							<div class="acts">
								{#if game.phase === 'roll'}
									{#if myPlayer.inJail}
										<button class="btn yellow" disabled={busy || myPlayer.money < JAIL_FINE} onclick={() => act({ type: 'payJail' })}>Bayar denda {formatRp(JAIL_FINE)}</button>
										{#if myPlayer.jailFree}
											<button class="btn yellow" disabled={busy} onclick={() => act({ type: 'useJailFree' })}>Pakai Pemutihan</button>
										{/if}
									{/if}
									<button class="btn primary big" disabled={busy || myPlayer.money < 0} onclick={() => act({ type: 'roll' })}>
										{myPlayer.inJail ? 'Coba dadu dobel' : game.extraRoll ? 'Lempar lagi (dobel!)' : 'Lempar dadu'}
										{#if spaceAct?.type === 'roll'}<kbd class="kbd">Spasi</kbd>{/if}
									</button>
								{:else if game.phase === 'buy' && pendingTile && !rolling && !moving}
									<button class="btn primary" disabled={busy || myPlayer.money < pendingTile.price} onclick={() => act({ type: 'buy' })}>
										Beli {pendingTile.name} ({formatRp(pendingTile.price)})
										{#if spaceAct?.type === 'buy'}<kbd class="kbd">Spasi</kbd>{/if}
									</button>
									<button class="btn" disabled={busy} onclick={() => act({ type: 'skip' })}>Lewati</button>
								{:else if game.phase === 'end'}
									{#if countdown}
										{#key countdown}<p class="countdown" aria-live="polite">{countdown}</p>{/key}
									{/if}
									<button class="btn small" disabled={busy || myPlayer.money < 0} onclick={() => act({ type: 'endTurn' })}>
										{countdown ? 'Lanjut sekarang' : 'Selesai giliran'}
										{#if spaceAct?.type === 'endTurn'}<kbd class="kbd">Spasi</kbd>{/if}
									</button>
								{/if}
								{#if myPlayer.money < 0}
									<button class="btn small" onclick={() => confirmAct('Yakin rungkat? Semua asetmu disita bank.', { type: 'bankrupt' })}>Nyatakan rungkat</button>
								{/if}
							</div>
						{:else if cur}
							<p class="turn-label">Giliran <span style:color={cur.color}>{cur.name}</span></p>
							{#if remote && remote.id === cur.id && remote.n}
								{#key remote.n}<p class="countdown" aria-live="polite">{remote.n}</p>{/key}
								<small>Giliran {cur.name} berakhir…</small>
							{/if}
							{#if !curOnline && myPlayer && !myPlayer.bankrupt}
								<button class="btn small" disabled={busy} onclick={() => emit('game:skip')}>Lewati giliran (dia offline)</button>
							{/if}
						{/if}
						{#if rentWait && rentInfo}
							<p class="rent-wait" class:urgent={rentLeft !== null && rentLeft <= 15}>
								{#if myTurn}Selesaikan tagihanmu, sisa waktu <strong>{rentWait}</strong>{:else}Tunggu, {cur?.name} sedang menyelesaikan tagihan <strong>{rentWait}</strong>{/if}
							</p>
						{/if}
					</div>
				{/snippet}
			</Board>
		</div>

		<aside class="side">
			<div class="cards" class:scroll={game.players.length > 3}>
				{#each game.players as p, i (p.id)}
					<div class="card-wrap">
					<PlayerCard
						{p}
						{game}
						speaking={!!speaking[p.id]}
						inVoice={voiceMembers.includes(p.id)}
							stream={voiceStreams[p.id] ?? null}
							micMuted={!!voiceStates[p.id]?.muted}
							camOn={!!voiceStates[p.id]?.cam}
							canControl={p.id === me?.id || isHost}
							onControl={(k) => voice?.control(p.id, k)}
						isTurn={game.status === 'playing' && i === game.turn}
						isMe={p.id === me?.id}
						online={game.online.includes(p.id)}
						isHost={p.id === game.hostId}
						roomCode={data.code}
						onCopyCode={copyInvite}
						hold={holdMoney || judHold(p.id)}
						{salary}
					/>
					{#if juds[p.id]}
						{@const jd = juds[p.id]}
						<div class="judol-pop" class:win={jd.done && jd.delta > 0} class:lose={jd.done && jd.delta < 0} aria-live="polite">
							<div class="reels">
								{#each jd.reels as r, i (i)}
									<span class="reel" class:spin={i >= jd.stopped}>{r}</span>
								{/each}
							</div>
							<div class="jinfo">
								<small>🎰 Taruhan {formatRp(jd.bet)}</small>
								{#if jd.done}
									<strong class="jpct">{jd.pct > 0 ? '+' : ''}{jd.pct}%</strong>
									<span class="jdelta">{jd.pct >= 90 ? '🎉 JACKPOT! ' : ''}{jd.delta >= 0 ? 'Menang' : 'Kalah'} {formatRp(Math.abs(jd.delta))}</span>
								{:else}
									<span class="jdelta">Memutar…</span>
								{/if}
							</div>
						</div>
					{/if}
					{#if canStartKick && p.id !== me?.id && !p.bankrupt}
						<button
							class="kick vote"
							title={`Voting keluarkan ${p.name}`}
							aria-label={`Voting keluarkan ${p.name}`}
							onclick={() => confirmAct(`Ajukan voting untuk mengeluarkan ${p.name}? Butuh 70% pemain lain setuju.`, { type: 'kickStart', target: p.id })}
						>🗳️</button>
					{/if}
					</div>
				{/each}
			</div>

			<div class="feed">
				<div class="tabs" role="tablist">
					<button role="tab" aria-selected={tab === 'chat'} class:active={tab === 'chat'} onclick={() => { tab = 'chat'; unread = 0; }}>
						Obrolan{#if unread}<span class="badge">{unread}</span>{/if}
					</button>
					<button role="tab" aria-selected={tab === 'market'} class:active={tab === 'market'} onclick={() => { tab = 'market'; mkUnseen = 0; }}>
						Pasar{#if mkUnseen || marketBadge}<span class="badge bell" aria-label="Ada kabar baru di Pasar">🔔{#if marketBadge} {marketBadge}{/if}</span>{/if}
					</button>
					<button role="tab" aria-selected={tab === 'portfolio'} class:active={tab === 'portfolio'} onclick={() => (tab = 'portfolio')}>Portofolio</button>
				</div>
				<div class="feed-body" class:tall={tab === 'market' || tab === 'portfolio'} bind:this={logEl}>
					{#if tab === 'market'}
						<Market {game} meId={me?.id} onAction={act} onTile={(i) => (selectedTile = i)} />
					{:else if tab === 'portfolio'}
						<Portfolio {game} meId={me?.id} onAction={act} onTile={(i) => (selectedTile = i)} />
					{:else}
						{#each chat as m}
							<p><time>{fmtTime(m.t)}</time> <strong>{m.name}:</strong> {m.text}</p>
						{:else}
							<p class="empty">Belum ada obrolan. Sapa yang lain!</p>
						{/each}
					{/if}
				</div>
				{#if tab === 'chat'}
					<form class="chat-form" onsubmit={sendChat}>
						<input bind:value={chatText} maxlength="300" placeholder="Tulis pesan…" aria-label="Pesan" />
						<button class="btn small">Kirim</button>
					</form>
				{/if}
			</div>

			{#if game.status === 'playing' && isHost}
				<div class="danger">
					{#if isHost}
						<button class="btn small" onclick={() => act({ type: 'pause', on: !game.paused })}>
							{game.paused ? '▶️ Lanjutkan game' : '⏸️ Jeda game'}
						</button>
						<button class="btn small" onclick={() => act({ type: 'autoPlay', on: !game.autoPlay })}>
							{game.autoPlay ? '🤖 Matikan auto-play AI' : '🤖 Auto-play AI'}
						</button>
						<button class="btn small" onclick={() => confirmAct('Akhiri game sekarang? Pemenang = kekayaan bersih terbesar.', { type: 'endGame' })}>Akhiri game</button>
					{/if}
				</div>
			{/if}
		</aside>
	</main>

	{#if selectedTile !== null}
		<TileSheet {game} images={cityImages} index={selectedTile} meId={me?.id} onAction={act} onClose={() => (selectedTile = null)} />
	{/if}

	{#if card}
		<button class="card-pop {card.deck}" onclick={() => (card = null)} aria-live="polite">
			<span class="card-kind">{card.deck === 'musibah' ? '⚡ Musibah' : card.deck === 'tax' ? '🧾 Pajak' : '🍀 Takdir'}</span>
			{#each game.players.filter((x) => x.id === card.playerId) as who (who.id)}
				<span class="card-ava" title={who.name}><Avatar p={who} />{#if richestId(game) === who.id}<span class="card-crown">👑</span>{/if}</span>
			{/each}
			<span class="card-who">{card.playerName}</span>
			<span class="card-text">{card.text}{#if card.amount} <strong>-{formatAmt(card.amount)}</strong>{/if}</span>
			<small>Klik untuk tutup</small>
		</button>
	{/if}
{/if}

{#if isHost && joinReqs.length}
	<div class="join-pop" role="alertdialog" aria-live="polite">
		<strong>✋ Minta gabung ({joinReqs.length})</strong>
		{#each joinReqs as r (r.id)}
			<div class="join-row">
				<span class="join-name">{r.name}</span>
				<button class="btn primary small" disabled={busy || game.players.length >= MAX_PLAYERS} onclick={() => emit('room:joinApprove', { userId: r.id })}>Setujui</button>
				<button class="btn small" disabled={busy} onclick={() => emit('room:joinReject', { userId: r.id })}>Tolak</button>
			</div>
		{/each}
		{#if game.players.length >= MAX_PLAYERS}<small>Room penuh (maks {MAX_PLAYERS}).</small>{/if}
	</div>
{/if}

{#if canRequestJoin}
	<div class="spectate-join" role="status">
		{#if iRequestedJoin}
			<span>⏳ Menunggu host menyetujui kamu gabung…</span>
		{:else}
			<span>Kamu menonton.</span>
			<button class="btn primary small" disabled={busy} onclick={() => emit('room:joinRequest')}>✋ Minta gabung</button>
		{/if}
	</div>
{/if}

{#if kvInfo}
	<div class="kick-pop" role="alertdialog" aria-live="polite">
		<strong>🗳️ Keluarkan {kvInfo.target?.name ?? 'pemain'}?</strong>
		<small>Diajukan {kvInfo.by?.name} · setuju {kvInfo.yes}/{kvInfo.need} dibutuhkan (dari {kvInfo.voters} pemain) · sisa {kvInfo.left} dtk</small>
		{#if kvInfo.canVote}
			<div class="kick-acts">
				<button class="btn small" class:primary={kvInfo.mine === true} onclick={() => act({ type: 'kickVote', agree: true })}>👍 Setuju</button>
				<button class="btn small" class:primary={kvInfo.mine === false} onclick={() => act({ type: 'kickVote', agree: false })}>👎 Tidak</button>
				{#if kv?.by === me?.id}<button class="btn small" onclick={() => act({ type: 'kickCancel' })}>Batalkan</button>{/if}
			</div>
		{:else}
			<small>Kamu tidak ikut voting ini.</small>
		{/if}
	</div>
{/if}

{#if game?.koWarnUntil && koLeft > 0}
	{@const mine = koPoorest && me && koPoorest.p.id === me.id}
	<div class="ko-pop" class:danger={mine} role="alertdialog" aria-live="assertive">
		<strong>☠️ KNOCK OUT {fmtLeft(koLeft)}</strong>
		<small>
			Pemain <b>termiskin</b> tereliminasi. Terancam sekarang:
			<b>{koPoorest?.p.name ?? '-'}</b>{#if koPoorest} ({formatRp(koPoorest.w)}){/if}{#if mine} — itu KAMU!{/if}
		</small>
		<small>Jual/beli aset, bangun, atau mainkan saham untuk menaikkan kekayaan bersihmu.</small>
	</div>
{/if}

{#if adBlocked}
	<div class="ad-wrap" role="alertdialog" aria-live="assertive" aria-label="Iklan properti">
		<div class="ad-card">
			<span class="ad-flag">📺 IKLAN</span>
			{#if game.ad.img || cityImages[game.ad.name]}
				<div class="ad-photo" style:background-image={`url("${game.ad.img ?? cityImages[game.ad.name].url}")`}></div>
			{/if}
			<p class="ad-text">{game.ad.text}</p>
			<small class="ad-by">Dipersembahkan oleh {game.ad.byName}</small>
			<div class="ad-actions">
				<span class="ad-count">{adLeft} dtk</span>
				<button class="btn primary" disabled={busy || (!!myPlayer && myPlayer.money < AD_SKIP_COST)} onclick={() => act({ type: 'iklanSkip' })}>
					Skip — bayar {formatRp(AD_SKIP_COST)}
				</button>
			</div>
			{#if myPlayer && myPlayer.money < AD_SKIP_COST}<small class="ad-poor">Uang kurang untuk skip — tunggu iklan selesai.</small>{/if}
		</div>
	</div>
{:else if adMine}
	<div class="ad-mine" role="status">📺 Iklanmu tayang — pemain lain ketahan {adLeft} dtk</div>
{/if}

{#if showRent && rentInfo}
	{@const ri = rentInfo}
	{@const rimg = cityImages[ri.tile.name]}
	<div class="rent-wrap">
		<div class="rent-pop" role="alertdialog" aria-labelledby="rent-text">
			<div class="rent-body">
				<div class="rent-text">
					<span class="card-kind">🧾 {ri.title}{#if rentWait} · ⏳ {rentWait}{/if}</span>
					<p id="rent-text">{ri.text} <em>({ri.detail})</em></p>
					{#if ri.owner.inJail}<small>Pemiliknya lagi di Ruang Sidang, jadi bayarannya masuk Kas Negara.</small>{/if}
				</div>
				<div class="rent-prev">
					<i class="fband" style:background={ri.tile.group ? GROUPS[ri.tile.group].color : 'var(--paper)'}></i>
					<span class="fthumb" style:background-image={rimg ? `url("${rimg.url}")` : null}>{#if !rimg}{ri.tile.short ?? '🏠'}{/if}</span>
					<strong>{ri.tile.name}</strong>
				</div>
			</div>
			{#if ri.short > 0}
				<p class="rent-short">Uangmu kurang {formatRp(ri.short)}. Jual rumah, gadai/jual aset (klik petakmu), atau jual saham di Portofolio. Kalau menyerah, semua asetmu jadi milik {ri.owner.name}.</p>
			{/if}
			<div class="rent-acts">
				<button class="btn primary big" disabled={busy || ri.short > 0} onclick={() => act({ type: 'payRent' })}>Bayar {formatRp(ri.r.amount)}{#if spaceAct?.type === 'payRent'}<kbd class="kbd">Spasi</kbd>{/if}</button>
				{#if ri.short > 0}
					<button class="btn small" onclick={surrender}>Menyerah</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if notifs.length}
	<div class="notifs" aria-live="polite">
		{#each notifs as n (n.id)}
			<button class="notif {n.kind}" onclick={() => { if (n.tile !== null) selectedTile = n.tile; else { tab = 'market'; mkUnseen = 0; } }}>{n.msg}</button>
		{/each}
	</div>
{/if}

{#if flight}
	{@const ft = listingTile(flight.tile)}
	{@const img = cityImages[ft.name]}
	{#key flight.n}
		<div class="flycard" use:fly={flight} aria-hidden="true">
			<i class="fband" style:background={ft.group ? GROUPS[ft.group].color : 'var(--paper)'}></i>
			<span class="fthumb" style:background-image={img ? `url("${img.url}")` : null}>{#if !img}{ft.short ?? '🏠'}{/if}</span>
			<strong>{ft.name}</strong>
			<small>{formatRp(flight.price)}</small>
		</div>
	{/key}
{/if}

{#if game && me}
	{#if myPlayer}<Netizen />{/if}
	<Voice bind:this={voice} bind:streams={voiceStreams} bind:states={voiceStates} {isHost} meId={me.id} canVoice={!!myPlayer} players={game.players} bind:speaking bind:members={voiceMembers} />
{/if}

{#if game && me}
	<div class="bottombar">
		<div class="react-wrap">
			{#if reactPop}
				<div class="react-backdrop" role="presentation" onclick={() => (reactPop = false)}></div>
				<div class="react-menu" role="menu" aria-label="Pilih reaksi">
					{#each REACTIONS as r (r.kind)}
						<button class="react-opt" role="menuitem" onclick={() => sendReaction(r.kind)} title={`${r.label} — tombol "${r.key}"`}>
							<img src={r.gif} alt={r.label} loading="lazy" />
							<span class="react-lbl">{r.emoji} {r.label}</span>
							<kbd>{r.key}</kbd>
						</button>
					{/each}
				</div>
			{/if}
			<button class="pill" onclick={() => (reactPop = !reactPop)} aria-expanded={reactPop} aria-label="Kirim reaksi">😂 Reaksi</button>
		</div>
		<button class="pill" onclick={() => (showLog = true)}>📜 Kejadian</button>
		{#if game.status === 'playing' && myPlayer && !myPlayer.bankrupt}
			<button class="pill" onclick={surrender}>Menyerah</button>
		{/if}
	</div>

	{#if reactions.length}
		<div class="reactions-layer" aria-hidden="true">
			{#each reactions as r (r.uid)}
				<div class="react-fly" style:--x="{r.x}px">
					<img src={REACTION_BY_KIND[r.kind]?.gif} alt="" />
					<span class="react-who">{r.name}</span>
				</div>
			{/each}
		</div>
	{/if}
{/if}

{#if showLog && game}
	<div class="log-backdrop" onclick={() => (showLog = false)} role="presentation"></div>
	<div class="log-modal" role="dialog" aria-modal="true" aria-label="Kejadian">
		<div class="log-head">
			<strong>📜 Kejadian</strong>
			<button class="log-close" onclick={() => (showLog = false)} aria-label="Tutup">✕</button>
		</div>
		<div class="log-body" bind:this={logModalEl}>
			{#each game.log as l}
				<p><time>{fmtTime(l.t)}</time> {l.msg}</p>
			{:else}
				<p class="empty">Belum ada kejadian.</p>
			{/each}
		</div>
	</div>
{/if}

{#if game?.paused && game.status === 'playing'}
	<div class="pause-overlay" role="alertdialog" aria-live="assertive" aria-label="Game dijeda">
		<div class="pause-card">
			<span class="pause-ico" aria-hidden="true">⏸️</span>
			<strong>Game dijeda host</strong>
			<p>Semua aksi dihentikan sementara. {isHost ? 'Tekan tombol di bawah untuk melanjutkan.' : 'Tunggu host melanjutkan permainan.'}</p>
			{#if isHost}
				<button class="btn primary" onclick={() => act({ type: 'pause', on: false })}>▶️ Lanjutkan game</button>
			{/if}
		</div>
	</div>
{/if}

{#if loseFx}
	{#key loseFx.n}
		<div class="lose-vignette" style:--i={Math.min(1, (loseFx.streak - 2) * 0.28)} aria-hidden="true"></div>
	{/key}
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
	.offline {
		position: fixed;
		top: 0.5rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 80;
		box-shadow: 0 2px 0 var(--ink);
		background: var(--angkot);
		color: var(--ink);
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-weight: 700;
		font-size: 0.85rem;
	}
	.center-msg {
		max-width: 480px;
		margin: 4rem auto;
		padding: 0 1rem;
		text-align: center;
		display: grid;
		gap: 1rem;
		justify-items: center;
	}

	/* lobby */
	.lobby {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
		align-items: start;
	}
	.room-badge {
		display: inline-block;
		background: var(--angkot);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.2rem 0.85rem;
		font-weight: 700;
		font-size: 0.85rem;
		box-shadow: 0 3px 0 var(--ink);
		margin-bottom: 0.9rem;
	}
	.room-badge b {
		font-family: 'JetBrains Mono', monospace;
		letter-spacing: 0.12em;
	}
	.invite h1 {
		font-size: clamp(2rem, 5vw, 3.2rem);
		line-height: 1;
		margin: 0 0 0.75rem;
		text-shadow: 2px 2px 0 rgba(255, 255, 255, 0.6);
	}
	.invite p {
		margin: 0 0 1rem;
		max-width: 42ch;
	}
	.link-row {
		display: flex;
		gap: 0.5rem;
	}
	.link-row input {
		flex: 1;
		min-width: 0;
	}
	.share {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}
	.invite p {
		background: rgba(255, 253, 246, 0.72);
		backdrop-filter: blur(3px);
		border: 2px solid rgba(20, 33, 61, 0.12);
		border-radius: var(--radius-m);
		padding: 0.7rem 0.9rem;
	}
	.players {
		background: rgba(255, 253, 246, 0.92);
		backdrop-filter: blur(6px);
		border: 2px solid var(--ink);
		border-radius: var(--radius-m);
		box-shadow: 8px 8px 0 var(--ink);
		padding: 1.25rem;
		display: grid;
		gap: 0.75rem;
	}
	.players h2,
	.plist {
		display: grid;
		gap: 0.5rem;
	}
	.prow {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.4rem;
		align-items: center;
	}
	.card-wrap {
		position: relative;
	}
	.kick.vote {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 26px;
		height: 26px;
		font-size: 0.8rem;
		cursor: pointer;
		opacity: 0.85;
	}
	.kick-pop {
		position: fixed;
		top: 4.6rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 66;
		width: min(380px, calc(100vw - 2rem));
		display: grid;
		gap: 0.3rem;
		padding: 0.6rem 0.8rem;
		background: #fff3c4;
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 4px 4px 0 var(--ink);
		animation: rentin 0.25s ease both;
	}
	.join-pop {
		position: fixed;
		top: 4.6rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 67;
		width: min(400px, calc(100vw - 2rem));
		display: grid;
		gap: 0.4rem;
		padding: 0.7rem 0.9rem;
		background: #e7f8ec;
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 4px 4px 0 var(--ink);
		animation: rentin 0.25s ease both;
	}
	.join-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.join-name {
		flex: 1 1 auto;
		min-width: 0;
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spectate-join {
		position: fixed;
		bottom: calc(1.25rem + var(--ticker-h, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: 67;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.8rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 999px;
		box-shadow: 4px 4px 0 var(--ink);
		font-weight: 700;
		font-size: 0.9rem;
	}
	.ko-opt {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.86rem;
		line-height: 1.35;
		background: #fff3f2;
		border: 2px solid var(--ink);
		border-radius: var(--radius-s);
		padding: 0.5rem 0.7rem;
		cursor: pointer;
	}
	.ko-opt input {
		margin-top: 0.15rem;
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
		accent-color: var(--merah);
	}
	.ko-note {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.35;
		background: #fff3f2;
		border: 2px solid var(--ink);
		border-radius: var(--radius-s);
		padding: 0.5rem 0.7rem;
	}
	.ko-pop {
		position: fixed;
		top: 4.6rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 66;
		width: min(420px, calc(100vw - 2rem));
		display: grid;
		gap: 0.25rem;
		padding: 0.6rem 0.9rem;
		background: #ffe08a;
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 4px 4px 0 var(--ink);
		animation: rentin 0.25s ease both;
		text-align: center;
	}
	.ko-pop strong {
		font-size: 1.2rem;
		font-variant-numeric: tabular-nums;
	}
	.ko-pop.danger {
		background: var(--merah);
		color: #fff;
	}
	.ko-pop.danger b {
		color: #fff;
	}
	/* iklan properti: overlay yang benar-benar memblok semua aksi pemain lain */
	.ad-wrap {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(20, 33, 61, 0.8);
		backdrop-filter: blur(2px);
	}
	.ad-card {
		width: min(420px, 100%);
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 16px;
		box-shadow: 8px 8px 0 var(--ink);
		padding: 1rem 1.1rem 1.2rem;
		display: grid;
		gap: 0.55rem;
		text-align: center;
		animation: rentin 0.25s ease both;
	}
	.ad-flag {
		justify-self: center;
		background: var(--merah);
		color: #fff;
		font-weight: 800;
		font-size: 0.78rem;
		letter-spacing: 0.12em;
		padding: 0.15rem 0.7rem;
		border-radius: 999px;
		border: 2px solid var(--ink);
	}
	.ad-photo {
		height: 150px;
		border: 2px solid var(--ink);
		border-radius: 10px;
		background-size: cover;
		background-position: center;
	}
	.ad-text {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 800;
		line-height: 1.3;
	}
	.ad-by {
		color: var(--ink-soft);
	}
	.ad-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.8rem;
		margin-top: 0.2rem;
	}
	.ad-count {
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		font-size: 1.3rem;
	}
	.ad-poor {
		color: var(--merah-deep);
		font-weight: 600;
	}
	.ad-mine {
		position: fixed;
		top: 4.6rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 66;
		background: var(--angkot);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.3rem 0.85rem;
		font-weight: 800;
		font-size: 0.85rem;
		box-shadow: 0 3px 0 var(--ink);
	}
	.kick-acts {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.kick {
		border: 2px solid var(--ink);
		background: #fff;
		border-radius: 50%;
		width: 30px;
		height: 30px;
	}
	.lobby-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.wait {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin: 0;
		padding: 0.6rem 0.9rem;
		background: var(--angkot);
		border: 2px solid var(--ink);
		border-radius: 999px;
		box-shadow: 0 3px 0 var(--ink);
	}
	.wait strong {
		display: block;
		line-height: 1.2;
	}
	.wait small {
		color: var(--ink-soft);
	}
	.dice-spin {
		font-size: 1.6rem;
		line-height: 1;
		animation: tumble 2.6s ease-in-out infinite;
	}
	@keyframes tumble {
		0%,
		60%,
		100% {
			transform: rotate(0);
		}
		78% {
			transform: translateY(-8px) rotate(200deg);
		}
		90% {
			transform: rotate(350deg);
		}
	}
	.dots i {
		animation: blink 1.4s infinite both;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}

	/* game */
	.game {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 1rem;
		padding: 1rem;
		max-width: 1600px;
		margin: 0 auto;
	}
	.board-wrap {
		/* papan landscape 14x8 (rasio 1,75): lebar dibatasi oleh tinggi layar */
		width: min(100%, calc((100vh - 4.8rem) * 1.75));
		margin: 0 auto;
	}
	.hub {
		display: grid;
		justify-items: center;
		gap: 0.6rem;
		text-align: center;
		width: 100%;
	}
	.decks {
		display: flex;
		align-items: center;
		gap: 4%;
		width: 100%;
		justify-content: center;
	}
	.deck {
		width: min(22%, 7rem);
		aspect-ratio: 0.68;
		border: 2px solid var(--ink);
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: clamp(0.6rem, 1.6vw, 1rem);
		box-shadow:
			3px 3px 0 var(--ink),
			6px 6px 0 rgba(20, 33, 61, 0.35);
	}
	.deck.musibah {
		background: var(--merah);
		color: #fff;
		transform: rotate(-6deg);
	}
	.deck.takdir {
		background: var(--angkot);
		transform: rotate(6deg);
	}
	.kas-col {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
	}
	.kas {
		display: grid;
		background: #fff;
		border: 2px dashed var(--ink);
		border-radius: 10px;
		padding: 0.3rem 0.6rem;
	}
	.kas small {
		font-size: 0.7rem;
	}
	.kas strong {
		font-size: clamp(0.8rem, 1.8vw, 1.1rem);
	}
	.dice {
		display: flex;
		gap: 0.5rem;
	}
	.countdown {
		margin: 0;
		font-size: 2.4rem;
		font-weight: 800;
		line-height: 1;
		animation: tick 1s ease-out;
	}
	@keyframes tick {
		from {
			transform: scale(1.8);
			opacity: 0;
		}
		30% {
			transform: scale(1);
			opacity: 1;
		}
	}
	.dice.rolling .die {
		animation: shake 0.16s linear infinite;
	}
	.dice.rolling .die:nth-child(2) {
		animation-direction: reverse;
	}
	@keyframes shake {
		0% {
			transform: rotate(-14deg) translateY(-3px);
		}
		50% {
			transform: rotate(14deg) translateY(2px);
		}
		100% {
			transform: rotate(-14deg) translateY(-3px);
		}
	}
	.die {
		width: clamp(32px, 6vw, 48px);
		aspect-ratio: 1;
		background: #fff;
		border: 2px solid var(--ink);
		border-radius: 8px;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: clamp(1rem, 2.5vw, 1.6rem);
		box-shadow: 0 3px 0 var(--ink);
	}
	@keyframes roll {
		0% {
			transform: rotate(-25deg) scale(0.6);
			opacity: 0;
		}
		70% {
			transform: rotate(8deg) scale(1.1);
		}
		100% {
			transform: none;
		}
	}
	.turn-label {
		margin: 0;
		font-weight: 800;
		font-size: clamp(1rem, 2.4vw, 1.5rem);
	}
	.acts {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: center;
	}
	.big {
		padding: 0.75rem 1.4rem;
		font-size: 1.1rem;
	}
	.debt {
		margin: 0;
		color: var(--merah-deep);
		font-weight: 700;
		font-size: 0.9rem;
		max-width: 40ch;
	}
	.kbd {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72em;
		font-weight: 700;
		line-height: 1.5;
		color: var(--ink);
		background: #fff;
		border: 1.5px solid var(--ink);
		border-radius: 5px;
		box-shadow: 0 2px 0 var(--ink);
		vertical-align: middle;
	}
	.ended h2 {
		margin: 0;
		font-size: clamp(1.4rem, 4vw, 2.4rem);
	}
	.ended p {
		margin: 0.2rem 0 0.7rem;
	}

	.side {
		display: grid;
		gap: 0.75rem;
		align-content: start;
	}
	.cards {
		display: grid;
		gap: 0.45rem;
	}
	.feed {
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: var(--radius-m);
		overflow: hidden;
		display: grid;
	}
	.tabs {
		display: flex;
		border-bottom: 2px solid var(--ink);
	}
	.tabs button {
		flex: 1;
		white-space: nowrap;
		border: 0;
		background: transparent;
		padding: 0.5rem;
		font-weight: 700;
		color: var(--ink-soft);
	}
	.tabs button.active {
		background: var(--angkot);
		color: var(--ink);
	}
	.badge {
		background: var(--merah);
		color: #fff;
		border-radius: 999px;
		padding: 0 0.4rem;
		margin-left: 0.3rem;
		font-size: 0.75rem;
	}
	.feed-body {
		height: 260px;
		overflow-y: auto;
		padding: 0.5rem 0.75rem;
		font-size: 0.86rem;
		line-height: 1.35;
	}
	.feed-body.tall {
		height: 440px;
	}
	.feed-body p {
		margin: 0 0 0.35rem;
	}
	.feed-body time {
		color: var(--ink-soft);
		font-size: 0.75rem;
	}
	.empty {
		color: var(--ink-soft);
	}
	.chat-form {
		display: flex;
		gap: 0.4rem;
		padding: 0.5rem;
		border-top: 2px solid var(--ink);
	}
	.chat-form input {
		flex: 1;
		min-width: 0;
		padding: 0.35rem 0.6rem;
	}
	/* bar bawah: Kejadian + Menyerah, tepat di kiri ikon pengaturan */
	.bottombar {
		position: fixed;
		right: 2.5rem;
		bottom: 0.2rem;
		z-index: 71;
		display: flex;
		gap: 0.4rem;
	}
	.pill {
		height: 1.8rem;
		padding: 0 0.75rem;
		border-radius: 999px;
		border: 2px solid var(--ink);
		background: #fff;
		box-shadow: 1px 1px 0 var(--ink);
		font-weight: 800;
		font-size: 0.72rem;
		cursor: pointer;
	}
	.react-wrap {
		position: relative;
	}
	.react-backdrop {
		position: fixed;
		inset: 0;
		z-index: 85;
	}
	.react-menu {
		position: absolute;
		right: 0;
		bottom: calc(100% + 0.4rem);
		z-index: 86;
		width: 200px;
		display: grid;
		gap: 0.3rem;
		padding: 0.4rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 14px;
		box-shadow: 4px 4px 0 var(--ink);
		animation: rentin 0.18s ease both;
	}
	.react-opt {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.4rem;
		border: 2px solid var(--ink);
		border-radius: 10px;
		background: #fff;
		cursor: pointer;
		font-weight: 700;
		font-size: 0.82rem;
		text-align: left;
	}
	.react-opt:hover {
		background: #fff3c4;
	}
	.react-opt img {
		width: 38px;
		height: 38px;
		object-fit: cover;
		border-radius: 7px;
		border: 1px solid var(--ink);
		flex: none;
		background: #eee;
	}
	.react-lbl {
		flex: 1 1 auto;
		min-width: 0;
	}
	.react-opt kbd {
		flex: none;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.72rem;
		background: var(--ink);
		color: #fff;
		border-radius: 5px;
		padding: 0.05rem 0.35rem;
	}
	.reactions-layer {
		position: fixed;
		inset: 0;
		z-index: 83;
		pointer-events: none;
		overflow: hidden;
	}
	.react-fly {
		position: absolute;
		left: 50%;
		bottom: 3.5rem;
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		transform: translateX(calc(-50% + var(--x, 0px)));
		animation: react-rise 3.6s cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}
	.react-fly img {
		width: clamp(96px, 22vw, 150px);
		height: auto;
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 3px 3px 0 var(--ink);
		background: #fff;
	}
	.react-who {
		font-weight: 800;
		font-size: 0.78rem;
		color: #fff;
		background: var(--ink);
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
	}
	@keyframes react-rise {
		0% { opacity: 0; transform: translateX(calc(-50% + var(--x, 0px))) translateY(30px) scale(0.6); }
		12% { opacity: 1; transform: translateX(calc(-50% + var(--x, 0px))) translateY(0) scale(1); }
		75% { opacity: 1; }
		100% { opacity: 0; transform: translateX(calc(-50% + var(--x, 0px))) translateY(-90px) scale(0.95); }
	}
	@media (prefers-reduced-motion: reduce) {
		.react-fly { animation: react-fade 3.6s ease both; }
		@keyframes react-fade { 0% { opacity: 0; } 10%, 80% { opacity: 1; } 100% { opacity: 0; } }
	}
	.log-backdrop {
		position: fixed;
		inset: 0;
		z-index: 84;
		background: rgba(20, 33, 61, 0.45);
	}
	.log-modal {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		z-index: 85;
		width: min(460px, calc(100vw - 2rem));
		max-height: min(70vh, 640px);
		display: grid;
		grid-template-rows: auto 1fr;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 14px;
		box-shadow: 8px 8px 0 var(--ink);
		overflow: hidden;
		animation: rentin 0.25s ease both;
	}
	.log-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6rem 0.9rem;
		border-bottom: 2px solid var(--ink);
		font-size: 1.05rem;
	}
	.log-close {
		border: 2px solid var(--ink);
		background: #fff;
		border-radius: 50%;
		width: 1.8rem;
		height: 1.8rem;
		font-weight: 800;
		cursor: pointer;
		line-height: 1;
	}
	.log-body {
		overflow-y: auto;
		padding: 0.6rem 0.9rem 0.9rem;
		font-size: 0.86rem;
		line-height: 1.4;
	}
	.log-body p {
		margin: 0 0 0.35rem;
	}
	.log-body time {
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
		margin-right: 0.3rem;
	}
	.danger {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.card-pop {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(360px, calc(100vw - 2rem));
		aspect-ratio: 1.45;
		border: 3px solid var(--ink);
		border-radius: 16px;
		box-shadow: 8px 8px 0 var(--ink);
		padding: 1.1rem 1.25rem;
		display: grid;
		grid-template-rows: auto auto 1fr auto;
		gap: 0.3rem;
		text-align: left;
		z-index: 50;
		animation: flip 0.6s ease-out;
	}
	.card-pop.musibah {
		background: var(--merah);
		color: #fff;
	}
	.card-pop.tax {
		background: #fde4e7;
		color: var(--ink);
	}
	.card-pop.takdir {
		background: var(--angkot);
		color: var(--ink);
	}
	.card-ava {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 2px solid var(--ink);
		background: #fff;
		font-size: 0.9rem;
	}
	.card-crown {
		position: absolute;
		top: -0.85rem;
		left: 50%;
		transform: translateX(-50%) rotate(-8deg);
		font-size: 1.1rem;
		line-height: 1;
	}
	.card-kind {
		font-weight: 800;
		font-size: 1.3rem;
	}
	.card-who {
		font-size: 0.85rem;
		opacity: 0.85;
	}
	.card-text {
		font-size: 1.1rem;
		font-weight: 600;
		align-self: center;
		line-height: 1.35;
	}
	.card-pop small {
		opacity: 0.7;
	}
	@keyframes flip {
		0% {
			transform: translate(-50%, -30%) rotateY(90deg) scale(0.5);
			opacity: 0;
		}
		60% {
			transform: translate(-50%, -52%) rotateY(-12deg) scale(1.06);
			opacity: 1;
		}
		100% {
			transform: translate(-50%, -50%);
		}
	}
	/* visual judod: slot menimpa kartu pemain yang sedang main (tiap pemain punya popup sendiri) */
	.judol-pop {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		z-index: 64;
		pointer-events: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.7rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 4px 4px 0 var(--ink);
		animation: jin 0.25s ease both;
		white-space: nowrap;
	}
	@keyframes jin {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.82);
		}
	}
	.judol-pop.win {
		background: #d8f5e2;
	}
	.judol-pop.lose {
		background: #fde0dc;
	}
	.jinfo {
		display: grid;
		gap: 0.05rem;
		text-align: left;
	}
	.reels {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}
	.reel {
		width: 2.6rem;
		height: 2.9rem;
		display: grid;
		place-items: center;
		font-size: 1.7rem;
		background: #fff;
		border: 2px solid var(--ink);
		border-radius: 8px;
		box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.08);
	}
	.reel.spin {
		filter: blur(1.5px);
	}
	.jpct {
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	.judol-pop.win .jpct {
		color: #1f8a4c;
	}
	.judol-pop.lose .jpct {
		color: var(--merah);
	}
	.jdelta {
		font-weight: 800;
	}
	.rent-wait {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--ink);
	}
	.rent-wait.urgent {
		color: var(--merah);
		animation: urgent 0.8s ease-in-out infinite alternate;
	}
	@keyframes urgent {
		to {
			opacity: 0.45;
		}
	}
	.rent-wrap {
		position: fixed;
		inset: 0;
		z-index: 65;
		display: grid;
		place-items: center;
		pointer-events: none;
		padding: 1rem;
	}
	.rent-pop {
		pointer-events: auto;
		width: min(440px, 100%);
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 16px;
		box-shadow: 8px 8px 0 var(--ink);
		padding: 1rem 1.1rem;
		display: grid;
		gap: 0.7rem;
		animation: rentin 0.25s ease both;
	}
	@keyframes rentin {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.96);
		}
	}
	.rent-body {
		display: grid;
		grid-template-columns: 1fr 130px;
		gap: 0.9rem;
		align-items: center;
	}
	.rent-text p {
		margin: 0.3rem 0;
		font-weight: 700;
		line-height: 1.35;
	}
	.rent-text em {
		font-style: normal;
		color: var(--ink-soft);
		font-weight: 600;
	}
	.rent-prev {
		display: grid;
		text-align: center;
		border: 3px solid var(--ink);
		border-radius: 10px;
		overflow: hidden;
		background: #fff;
	}
	.rent-prev strong {
		font-size: 0.8rem;
		padding: 0.25rem;
	}
	.rent-short {
		margin: 0;
		font-size: 0.82rem;
		color: var(--merah);
		font-weight: 700;
	}
	.rent-acts {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		flex-wrap: wrap;
	}
	.notifs {
		position: fixed;
		top: 0.9rem;
		left: 50%;
		transform: translateX(-50%);
		display: grid;
		gap: 0.4rem;
		z-index: 70;
		width: min(420px, calc(100vw - 2rem));
		pointer-events: none;
	}
	.notif {
		all: unset;
		box-sizing: border-box;
		pointer-events: auto;
		cursor: pointer;
		background: #fff;
		border: 2px solid var(--ink);
		border-radius: 10px;
		box-shadow: 3px 3px 0 var(--ink);
		padding: 0.5rem 0.75rem;
		font-weight: 700;
		font-size: 0.85rem;
		animation: notif 4.2s ease both;
	}
	.notif.offer {
		background: #fff3c4;
	}
	.notif.sold {
		background: #d8f5e2;
	}
	.notif.buy,
	.notif.build {
		background: #e3f0ff;
	}
	.notif.reject {
		background: #fde0dc;
	}
	@keyframes notif {
		0% {
			opacity: 0;
			transform: translateY(-14px);
		}
		8%,
		80% {
			opacity: 1;
			transform: none;
		}
		100% {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
	.badge.bell {
		animation: ring 1.2s ease-in-out infinite;
	}
	@keyframes ring {
		0%,
		60%,
		100% {
			transform: rotate(0);
		}
		70% {
			transform: rotate(-14deg);
		}
		80% {
			transform: rotate(12deg);
		}
		90% {
			transform: rotate(-8deg);
		}
	}
	.flycard {
		position: fixed;
		z-index: 80;
		pointer-events: none;
		width: 150px;
		background: #fff;
		border: 3px solid var(--ink);
		border-radius: 10px;
		box-shadow: 5px 5px 0 var(--ink);
		overflow: hidden;
		display: grid;
		text-align: center;
		opacity: 0;
	}
	.fband {
		height: 14px;
		border-bottom: 2px solid var(--ink);
	}
	.fthumb {
		height: 70px;
		background: var(--paper) center / cover;
		display: grid;
		place-items: center;
		font-weight: 800;
		font-size: 1.4rem;
	}
	.flycard strong {
		font-size: 0.85rem;
		padding: 0.25rem 0.3rem 0;
	}
	.flycard small {
		padding-bottom: 0.3rem;
		color: var(--ink-soft);
		font-weight: 700;
	}
	.toast {
		position: fixed;
		bottom: calc(1.25rem + var(--ticker-h, 0px));
		left: 50%;
		transform: translateX(-50%);
		background: var(--ink);
		color: #fff;
		padding: 0.7rem 1rem;
		border-radius: 10px;
		font-weight: 600;
		z-index: 60;
		max-width: calc(100vw - 2rem);
	}

	.pause-overlay {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgba(20, 33, 61, 0.55);
		backdrop-filter: blur(3px);
		animation: fadein 0.2s ease both;
	}
	.pause-card {
		width: min(360px, calc(100vw - 2rem));
		display: grid;
		justify-items: center;
		gap: 0.5rem;
		padding: 1.4rem 1.2rem;
		text-align: center;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 16px;
		box-shadow: 6px 6px 0 var(--ink);
	}
	.pause-ico {
		font-size: 2.6rem;
		line-height: 1;
		animation: pausepulse 1.8s ease-in-out infinite;
	}
	.pause-card strong {
		font-size: 1.3rem;
	}
	.pause-card p {
		margin: 0;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}
	.pause-card .btn {
		margin-top: 0.4rem;
	}
	@keyframes fadein {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	@keyframes pausepulse {
		0%, 100% { transform: scale(1); opacity: 0.9; }
		50% { transform: scale(1.12); opacity: 1; }
	}

	/* vignette merah saat kalah judod beruntun; --i (0..1) = intensitas, makin sering kalah makin merah */
	.lose-vignette {
		position: fixed;
		inset: 0;
		z-index: 95;
		pointer-events: none;
		background: radial-gradient(
			ellipse at center,
			transparent calc(42% - var(--i, 0.3) * 22%),
			rgba(190, 0, 20, calc(0.35 + var(--i, 0.3) * 0.5)) 100%
		);
		animation: lose-vig 2s ease-out forwards;
	}
	@keyframes lose-vig {
		0% { opacity: 0; }
		10% { opacity: 1; }
		100% { opacity: 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.lose-vignette { animation-duration: 2s; }
	}

	/* desktop: kolom kanan pas setinggi layar; scrollbar hanya di dalam isi tiap tab */
	@media (min-width: 901px) {
		.game {
			height: calc(100vh - var(--ticker-h, 0px));
		}
		.side {
			display: flex;
			flex-direction: column;
			min-height: 0;
			height: 100%;
		}
		.cards {
			flex: none;
		}
		/* banyak pemain: daftar kartu dibatasi setengah tinggi dan bisa di-scroll */
		.cards.scroll {
			flex: 0 1 auto;
			min-height: 0;
			max-height: 50%;
			overflow-y: auto;
			overflow-x: hidden;
			padding: 0.8rem 0.3rem 0.3rem 0;
			margin-top: -0.8rem;
		}
		.feed {
			flex: 1 1 0;
			min-height: 11rem;
			display: flex;
			flex-direction: column;
		}
		.feed-body,
		.feed-body.tall {
			flex: 1 1 0;
			height: auto;
			min-height: 0;
		}
		.tabs,
		.chat-form,
		.danger {
			flex: none;
		}
	}
	@media (max-width: 900px) {
		.judol-pop {
			max-width: 94%;
		}
		.game {
			grid-template-columns: 1fr;
			padding: 0.5rem;
		}
		.board-wrap {
			width: 100%;
		}
		.lobby {
			grid-template-columns: 1fr;
		}
		.hint {
			display: none;
		}
		.feed-body {
			height: 200px;
		}
		/* ruang untuk tombol suara/netizen yang menempel di bawah layar */
		.game {
			padding-bottom: 4.5rem;
		}
	}
	@media (max-width: 520px) {
		.game {
			padding: 0.35rem 0.35rem 4.5rem;
			gap: 0.6rem;
		}
		.players {
			padding: 0.9rem;
		}
		.card-pop {
			aspect-ratio: auto;
			min-height: 10rem;
			padding: 0.9rem 1rem;
			box-shadow: 5px 5px 0 var(--ink);
		}
		.rent-wrap {
			padding: 0.5rem;
		}
		.rent-pop {
			padding: 0.8rem;
			max-height: calc(100dvh - 1rem);
			overflow-y: auto;
		}
		.toast {
			bottom: 4rem;
		}
	}
</style>
