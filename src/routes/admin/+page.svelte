<script>
	import { onMount } from 'svelte';
	import { getSocket } from '$lib/socket.js';
	import { TILES, formatRp } from '$lib/shared/board.js';

	let { data } = $props();

	/** @type {import('socket.io-client').Socket | null} */
	let socket = null;

	let connected = $state(false);
	let denied = $state(false);
	let serverNow = $state(Date.now());
	/** @type {any[]} */
	let roomsList = $state([]);
	let totals = $state({ rooms: 0, lobby: 0, playing: 0, ended: 0, players: 0, bots: 0 });

	const STATUS = {
		lobby: { label: 'Lobi', cls: 'st-lobby' },
		playing: { label: 'Main', cls: 'st-play' },
		ended: { label: 'Selesai', cls: 'st-end' }
	};

	// playing dulu, lalu lobi, lalu selesai; dalam tiap grup yang terbaru di atas
	const order = { playing: 0, lobby: 1, ended: 2 };
	const sorted = $derived(
		[...roomsList].sort((a, b) => (order[a.status] - order[b.status]) || b.createdAt - a.createdAt)
	);

	const tileName = (i) => TILES[i]?.name ?? `Petak ${i}`;

	function age(createdAt) {
		const s = Math.max(0, Math.floor((serverNow - createdAt) / 1000));
		if (s < 60) return `${s} dtk`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m} mnt`;
		return `${Math.floor(m / 60)} jam ${m % 60} mnt`;
	}

	function apply(payload) {
		if (!payload) return;
		serverNow = payload.now ?? Date.now();
		roomsList = payload.rooms ?? [];
		if (payload.totals) totals = payload.totals;
	}

	function editMoney(roomCode, p) {
		const input = window.prompt(`Set saldo untuk ${p.name} (room ${roomCode}):`, String(p.money));
		if (input == null) return;
		const money = Math.trunc(Number(input.replace(/[^\d-]/g, '')));
		if (!Number.isFinite(money) || money < 0) {
			alert('Nominal tidak valid.');
			return;
		}
		socket?.emit('admin:setMoney', { code: roomCode, playerId: p.id, money }, (res) => {
			if (!res?.ok) alert(`Gagal: ${res?.error ?? 'tidak diketahui'}`);
		});
	}

	onMount(() => {
		const s = getSocket();
		socket = s;
		const onRooms = (p) => apply(p);
		const onConnect = () => {
			connected = true;
			s.emit('admin:subscribe', {}, (res) => {
				if (res?.ok) apply(res);
				else denied = true;
			});
		};
		const onDisconnect = () => (connected = false);

		s.on('admin:rooms', onRooms);
		s.on('connect', onConnect);
		s.on('disconnect', onDisconnect);
		if (s.connected) onConnect();

		// jam lokal berjalan di antara update supaya "umur" tidak terasa patah
		const tick = setInterval(() => (serverNow += 1000), 1000);

		return () => {
			clearInterval(tick);
			s.off('admin:rooms', onRooms);
			s.off('connect', onConnect);
			s.off('disconnect', onDisconnect);
			s.emit('admin:unsubscribe');
			socket = null;
		};
	});
</script>

<svelte:head>
	<title>Admin · Jadi WNI</title>
</svelte:head>

<div class="admin-bg" aria-hidden="true"></div>

<main class="admin">
	<header>
		<div class="title">
			<h1>Panel Admin</h1>
			<span class="live" class:on={connected}>{connected ? '● LIVE' : '○ tersambung…'}</span>
		</div>
		<p class="who">Masuk sebagai <strong>{data.me?.name}</strong> ({data.me?.email})</p>
		<div class="totals">
			<div class="stat"><b>{totals.rooms}</b><span>Room</span></div>
			<div class="stat play"><b>{totals.playing}</b><span>Main</span></div>
			<div class="stat lobby"><b>{totals.lobby}</b><span>Lobi</span></div>
			<div class="stat end"><b>{totals.ended}</b><span>Selesai</span></div>
			<div class="stat"><b>{totals.players}</b><span>Pemain</span></div>
			<div class="stat"><b>{totals.bots}</b><span>Bot</span></div>
		</div>
	</header>

	{#if denied}
		<p class="empty">Akses ditolak. Akun ini bukan admin.</p>
	{:else if sorted.length === 0}
		<p class="empty">Belum ada room aktif. Begitu ada yang membuat room, langsung muncul di sini.</p>
	{:else}
		<div class="grid">
			{#each sorted as r (r.code)}
				<article class="room">
					<div class="rhead">
						<a class="code" href={`/room/${r.code}`} title="Buka / tonton room">{r.code}</a>
						<span class={`badge ${STATUS[r.status]?.cls ?? ''}`}>{STATUS[r.status]?.label ?? r.status}</span>
						<span class="age">{age(r.createdAt)}</span>
					</div>
					<div class="meta">
						<span>👥 {r.online} online</span>
						<span>🔁 giliran {r.turnCount}</span>
						<span>🏛️ {formatRp(r.kasNegara)}</span>
					</div>
					<ul class="players">
						{#each r.players as p (p.id)}
							<li class:turn={p.id === r.turnId && r.status === 'playing'} class:dead={p.bankrupt}>
								<span class="dot" class:online={p.online}></span>
								<span class="nm">
									{p.name}
									{#if p.host}<i class="tag host">host</i>{/if}
									{#if p.bot}<i class="tag bot">bot</i>{/if}
									{#if p.id === r.winnerId}<i class="tag win">🏆</i>{/if}
								</span>
								<span class="pos">{tileName(p.pos)}</span>
								<button class="cash" type="button" title="Klik untuk ubah saldo" onclick={() => editMoney(r.code, p)}>{formatRp(p.money)}</button>
							</li>
						{/each}
					</ul>
				</article>
			{/each}
		</div>
	{/if}
</main>

<style>
	.admin-bg {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: radial-gradient(circle at 20% 0%, #1e2f52, #141f33 70%);
	}
	.admin {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.75rem 1rem 3rem;
		color: #eef2fb;
	}
	header {
		margin-bottom: 1.5rem;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 4vw, 2.6rem);
		letter-spacing: -0.02em;
	}
	.live {
		font-weight: 700;
		font-size: 0.8rem;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		color: #c7d2e8;
	}
	.live.on {
		background: rgba(46, 158, 91, 0.25);
		color: #7ff0ab;
	}
	.who {
		margin: 0.4rem 0 1rem;
		color: #aeb9d4;
		font-size: 0.9rem;
	}
	.totals {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.stat {
		background: rgba(255, 255, 255, 0.07);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 12px;
		padding: 0.5rem 0.9rem;
		display: grid;
		justify-items: center;
		min-width: 74px;
	}
	.stat b {
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1;
	}
	.stat span {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aeb9d4;
		margin-top: 0.2rem;
	}
	.stat.play b {
		color: #7ff0ab;
	}
	.stat.lobby b {
		color: #ffd94d;
	}
	.stat.end b {
		color: #9fb0d0;
	}
	.empty {
		background: rgba(255, 255, 255, 0.06);
		border: 1px dashed rgba(255, 255, 255, 0.2);
		border-radius: 14px;
		padding: 2rem;
		text-align: center;
		color: #c7d2e8;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
		gap: 1rem;
	}
	.room {
		background: #fffdf6;
		color: var(--ink);
		border: 2px solid var(--ink);
		border-radius: 14px;
		box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.35);
		overflow: hidden;
	}
	.rhead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.75rem;
		border-bottom: 2px solid var(--ink);
	}
	.code {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 800;
		font-size: 1.15rem;
		letter-spacing: 0.12em;
		color: var(--ink);
		text-decoration: none;
		border-bottom: 2px dotted transparent;
	}
	.code:hover {
		border-bottom-color: var(--ink);
	}
	.badge {
		font-weight: 700;
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		border: 1.5px solid var(--ink);
	}
	.st-play {
		background: #b7f0cd;
	}
	.st-lobby {
		background: var(--angkot);
	}
	.st-end {
		background: #dfe4ee;
	}
	.age {
		margin-left: auto;
		font-size: 0.78rem;
		color: var(--ink-soft);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.9rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--ink-soft);
		border-bottom: 1px solid var(--line);
	}
	.players {
		list-style: none;
		margin: 0;
		padding: 0.35rem 0.5rem 0.5rem;
		display: grid;
		gap: 0.1rem;
	}
	.players li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.1rem 0.5rem;
		padding: 0.3rem 0.4rem;
		border-radius: 8px;
		font-size: 0.86rem;
	}
	.players li.turn {
		background: #fff3c4;
		box-shadow: inset 3px 0 0 var(--merah);
	}
	.players li.dead {
		opacity: 0.5;
	}
	.players li.dead .nm {
		text-decoration: line-through;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #c2c9d6;
		border: 1px solid rgba(0, 0, 0, 0.25);
	}
	.dot.online {
		background: var(--ok);
	}
	.nm {
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}
	.tag {
		font-style: normal;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.05rem 0.3rem;
		border-radius: 5px;
		border: 1px solid var(--ink);
	}
	.tag.host {
		background: var(--angkot);
	}
	.tag.bot {
		background: #d9e8ff;
	}
	.tag.win {
		border: 0;
		font-size: 0.8rem;
		padding: 0;
	}
	.pos {
		grid-column: 2;
		grid-row: 2;
		font-size: 0.72rem;
		color: var(--ink-soft);
	}
	.cash {
		grid-column: 3;
		grid-row: 1 / span 2;
		align-self: center;
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		font-size: 0.82rem;
		white-space: nowrap;
		color: var(--ink);
		background: transparent;
		border: 1px dashed transparent;
		border-radius: 6px;
		padding: 0.1rem 0.3rem;
		cursor: pointer;
	}
	.cash:hover {
		border-color: var(--ink);
		background: #fff3c4;
	}
	@media (max-width: 560px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
