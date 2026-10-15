<script>
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getSocket, call } from '$lib/socket.js';
	import Board from '$lib/components/Board.svelte';
	import TileSheet from '$lib/components/TileSheet.svelte';
	import PlayerCard from '$lib/components/PlayerCard.svelte';
	import {
		TILES,
		TOKENS,
		JAIL_FINE,
		MIN_PLAYERS,
		MAX_PLAYERS,
		formatRp
	} from '$lib/shared/board.js';

	let { data } = $props();
	const me = $derived(page.data.user);

	/** @type {any} */
	let game = $state(null);
	let joinError = $state('');
	let toast = $state('');
	let toastTimer;
	let selectedTile = $state(/** @type {number|null} */ (null));
	let tab = $state('log');
	let chat = $state(/** @type {any[]} */ ([]));
	let chatText = $state('');
	let unread = $state(0);
	let busy = $state(false);
	let connected = $state(true);
	let card = $state(/** @type {any} */ (null));
	let lastCardSeq = -1;
	let logEl = $state();

	const inviteUrl = $derived(`${page.url.origin}/room/${data.code}`);
	const myPlayer = $derived(game?.players.find((p) => p.id === me?.id));
	const isHost = $derived(game?.hostId === me?.id);
	const cur = $derived(game?.status === 'playing' ? game.players[game.turn] : null);
	const myTurn = $derived(!!cur && cur.id === me?.id);
	const curOnline = $derived(!!cur && game.online.includes(cur.id));
	const winner = $derived(game?.winner ? game.players.find((p) => p.id === game.winner) : null);
	const pendingTile = $derived(game?.pendingBuy != null ? TILES[game.pendingBuy] : null);

	function showToast(msg) {
		toast = msg;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 3500);
	}

	async function join() {
		const res = await call('room:join', { code: data.code });
		if (!res.ok) joinError = res.error;
	}

	onMount(() => {
		const s = getSocket();
		const onState = (st) => {
			if (lastCardSeq === -1) lastCardSeq = st.lastCard?.seq ?? 0;
			else if (st.lastCard && st.lastCard.seq > lastCardSeq) {
				lastCardSeq = st.lastCard.seq;
				card = st.lastCard;
			}
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
		s.on('connect', onConnect);
		s.on('disconnect', onDisconnect);
		s.on('connect_error', onConnectError);
		if (s.connected) join();
		return () => {
			s.off('room:state', onState);
			s.off('chat', onChat);
			s.off('chat:history', onHistory);
			s.off('connect', onConnect);
			s.off('disconnect', onDisconnect);
			s.off('connect_error', onConnectError);
		};
	});

	$effect(() => {
		// auto-scroll log
		game?.log.length;
		chat.length;
		tab;
		tick().then(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
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
	const act = (a) => emit('game:action', a);

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

<header class="top">
	<a href="/" class="logo">Jadi WNI</a>
	<button class="code" onclick={copyInvite} title="Salin link undangan">
		Room <strong>{data.code}</strong>
	</button>
	{#if !connected}<span class="offline" role="status">Menyambung ulang…</span>{/if}
</header>

{#if joinError}
	<main class="center-msg">
		<h1>Tidak bisa masuk room</h1>
		<p>{joinError}</p>
		<a class="btn primary" href="/">Kembali ke beranda</a>
	</main>
{:else if !game}
	<main class="center-msg"><p>Menyiapkan room…</p></main>
{:else if game.status === 'lobby'}
	<main class="lobby">
		<section class="invite">
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
						/>
						{#if isHost && p.id !== me?.id}
							<button class="kick" onclick={() => emit('room:kick', { userId: p.id })} aria-label={`Keluarkan ${p.name}`}>✕</button>
						{/if}
					</div>
				{/each}
			</div>

			{#if myPlayer}
				<h3>Pilih bidak</h3>
				<div class="tokens">
					{#each TOKENS as t}
						{@const takenBy = game.players.find((p) => p.token === t.id)}
						<button
							class="tokbtn"
							class:mine={myPlayer.token === t.id}
							disabled={!!takenBy && takenBy.id !== me?.id}
							onclick={() => emit('room:token', { token: t.id })}
							title={t.label}
						>
							<span>{t.icon}</span><small>{t.label}</small>
						</button>
					{/each}
				</div>
			{:else}
				<p>Kamu menonton room ini.</p>
			{/if}

			<div class="lobby-actions">
				{#if isHost}
					<button class="btn primary" disabled={busy || game.players.length < MIN_PLAYERS} onclick={() => emit('game:start')}>
						Mulai game
					</button>
					{#if game.players.length < MIN_PLAYERS}<small>Butuh minimal {MIN_PLAYERS} pemain.</small>{/if}
				{:else}
					<p class="wait">Menunggu host memulai game…</p>
				{/if}
				<button class="btn small" onclick={leave}>Keluar room</button>
			</div>
		</section>
	</main>
{:else}
	<main class="game">
		<div class="board-wrap">
			<Board {game} onTile={(i) => (selectedTile = i)}>
				{#snippet center()}
					<div class="hub">
						<div class="decks">
							<div class="deck musibah">Musibah</div>
							<div class="arisan">
								<small>Kas Arisan</small>
								<strong>{formatRp(game.arisan)}</strong>
							</div>
							<div class="deck takdir">Takdir</div>
						</div>

						{#if game.dice}
							{#key game.seq}
								<div class="dice" aria-label={`Dadu ${game.dice[0]} dan ${game.dice[1]}`}>
									<span class="die">{game.dice[0]}</span><span class="die">{game.dice[1]}</span>
								</div>
							{/key}
						{/if}

						{#if game.status === 'ended'}
							<div class="ended">
								<h2>🏆 {winner?.name ?? '—'}</h2>
								<p>Jadi WNI paling sukses.</p>
								<button class="btn primary" onclick={newRoom}>Main lagi (room baru)</button>
							</div>
						{:else if myTurn}
							<p class="turn-label">Giliranmu!</p>
							{#if myPlayer.money < 0}
								<p class="debt">Saldo minus {formatRp(myPlayer.money)}. Jual rumah atau gadai aset (klik petakmu), atau nyatakan bangkrut.</p>
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
									</button>
								{:else if game.phase === 'buy' && pendingTile}
									<button class="btn primary" disabled={busy || myPlayer.money < pendingTile.price} onclick={() => act({ type: 'buy' })}>
										Beli {pendingTile.name} ({formatRp(pendingTile.price)})
									</button>
									<button class="btn" disabled={busy} onclick={() => act({ type: 'skip' })}>Lewati</button>
								{:else if game.phase === 'end'}
									<button class="btn primary big" disabled={busy || myPlayer.money < 0} onclick={() => act({ type: 'endTurn' })}>Selesai giliran</button>
								{/if}
								{#if myPlayer.money < 0}
									<button class="btn small" onclick={() => confirmAct('Yakin bangkrut? Semua asetmu disita bank.', { type: 'bankrupt' })}>Nyatakan bangkrut</button>
								{/if}
							</div>
						{:else if cur}
							<p class="turn-label">Giliran <span style:color={cur.color}>{cur.name}</span></p>
							{#if !curOnline && myPlayer && !myPlayer.bankrupt}
								<button class="btn small" disabled={busy} onclick={() => emit('game:skip')}>Lewati giliran (dia offline)</button>
							{/if}
						{/if}
						<p class="hint">Klik petak untuk lihat detail, bangun rumah, atau gadai.</p>
					</div>
				{/snippet}
			</Board>
		</div>

		<aside class="side">
			<div class="cards">
				{#each game.players as p, i (p.id)}
					<PlayerCard
						{p}
						{game}
						isTurn={game.status === 'playing' && i === game.turn}
						isMe={p.id === me?.id}
						online={game.online.includes(p.id)}
						isHost={p.id === game.hostId}
					/>
				{/each}
			</div>

			<div class="feed">
				<div class="tabs" role="tablist">
					<button role="tab" aria-selected={tab === 'log'} class:active={tab === 'log'} onclick={() => (tab = 'log')}>Kejadian</button>
					<button role="tab" aria-selected={tab === 'chat'} class:active={tab === 'chat'} onclick={() => { tab = 'chat'; unread = 0; }}>
						Obrolan{#if unread}<span class="badge">{unread}</span>{/if}
					</button>
				</div>
				<div class="feed-body" bind:this={logEl}>
					{#if tab === 'log'}
						{#each game.log as l}
							<p><time>{fmtTime(l.t)}</time> {l.msg}</p>
						{/each}
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

			{#if game.status === 'playing'}
				<div class="danger">
					{#if myPlayer && !myPlayer.bankrupt}
						<button class="btn small" onclick={() => confirmAct('Menyerah dan bangkrut? Semua asetmu disita bank.', { type: 'bankrupt' })}>Menyerah</button>
					{/if}
					{#if isHost}
						<button class="btn small" onclick={() => confirmAct('Akhiri game sekarang? Pemenang = kekayaan bersih terbesar.', { type: 'endGame' })}>Akhiri game</button>
					{/if}
				</div>
			{/if}
		</aside>
	</main>

	{#if selectedTile !== null}
		<TileSheet {game} index={selectedTile} meId={me?.id} onAction={act} onClose={() => (selectedTile = null)} />
	{/if}

	{#if card}
		<button class="card-pop {card.deck}" onclick={() => (card = null)} aria-live="polite">
			<span class="card-kind">{card.deck === 'musibah' ? '⚡ Musibah' : '🍀 Takdir'}</span>
			<span class="card-who">{card.playerName}</span>
			<span class="card-text">{card.text}</span>
			<small>Klik untuk tutup</small>
		</button>
	{/if}
{/if}

{#if toast}<div class="toast" role="status">{toast}</div>{/if}

<style>
	.top {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 3px solid var(--ink);
		background: var(--merah);
		color: #fff;
	}
	.logo {
		color: #fff;
		font-weight: 800;
		font-size: 1.35rem;
		text-decoration: none;
		letter-spacing: -0.02em;
	}
	.code {
		margin-left: auto;
		background: #fff;
		color: var(--ink);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.25rem 0.8rem;
	}
	.code strong {
		letter-spacing: 0.12em;
	}
	.offline {
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
	.invite h1 {
		font-size: clamp(2rem, 5vw, 3.2rem);
		line-height: 1;
		margin: 0 0 0.75rem;
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
	.players {
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: var(--radius-m);
		padding: 1.25rem;
		display: grid;
		gap: 0.75rem;
	}
	.players h2,
	.players h3 {
		margin: 0;
	}
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
	.kick {
		border: 2px solid var(--ink);
		background: #fff;
		border-radius: 50%;
		width: 30px;
		height: 30px;
	}
	.tokens {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.4rem;
	}
	.tokbtn {
		border: 2px solid var(--ink);
		background: #fff;
		border-radius: 10px;
		padding: 0.3rem 0.1rem;
		display: grid;
		justify-items: center;
	}
	.tokbtn span {
		font-size: 1.6rem;
	}
	.tokbtn small {
		font-size: 0.65rem;
	}
	.tokbtn.mine {
		background: var(--angkot);
		box-shadow: 0 3px 0 var(--ink);
	}
	.lobby-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.wait {
		margin: 0;
		font-weight: 600;
	}

	/* game */
	.game {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 1rem;
		padding: 1rem;
		max-width: 1300px;
		margin: 0 auto;
	}
	.board-wrap {
		width: min(100%, calc(100vh - 6rem));
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
		width: 22%;
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
	.arisan {
		display: grid;
		background: #fff;
		border: 2px dashed var(--ink);
		border-radius: 10px;
		padding: 0.3rem 0.6rem;
	}
	.arisan small {
		font-size: 0.7rem;
	}
	.arisan strong {
		font-size: clamp(0.8rem, 1.8vw, 1.1rem);
	}
	.dice {
		display: flex;
		gap: 0.5rem;
		animation: roll 0.45s ease-out;
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
	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--ink-soft);
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
		animation: flip 0.4s ease-out;
	}
	.card-pop.musibah {
		background: var(--merah);
		color: #fff;
	}
	.card-pop.takdir {
		background: var(--angkot);
		color: var(--ink);
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
		from {
			transform: translate(-50%, -50%) rotateY(90deg);
		}
		to {
			transform: translate(-50%, -50%);
		}
	}
	.toast {
		position: fixed;
		bottom: 1.25rem;
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

	@media (max-width: 900px) {
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
	}
</style>
