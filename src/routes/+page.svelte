<script>
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { call, getSocket } from '$lib/socket.js';
	import { HOUSE_LEVELS } from '$lib/shared/board.js';

	let { data } = $props();

	const next = $derived(page.url.searchParams.get('next') ?? '/');
	let joinCode = $state('');
	let busy = $state(false);
	let error = $state('');

	async function createRoom() {
		busy = true;
		error = '';
		getSocket();
		const res = await call('room:create');
		busy = false;
		if (!res.ok) return (error = res.error);
		goto(`/room/${res.code}`);
	}

	function joinRoom(e) {
		e.preventDefault();
		const code = joinCode.trim().toUpperCase();
		if (code.length < 4) return (error = 'Kode room terdiri dari 6 huruf/angka.');
		goto(`/room/${code}`);
	}
</script>

<svelte:head>
	<title>Jadi WNI — Monopoli kehidupan</title>
</svelte:head>

<main>
	<section class="hero">
		<div class="ktp" aria-label="Kartu identitas permainan">
			<div class="ktp-head">
				<span>PROVINSI SERBA ADA</span>
				<span>KABUPATEN GAJIAN</span>
			</div>
			<div class="ktp-body">
				<h1>Jadi WNI</h1>
				<dl>
					<dt>Pekerjaan</dt>
					<dd>Lempar dadu, bayar cicilan</dd>
					<dt>Status</dt>
					<dd>Dari Rumah Subsidi menuju Rumah OKB</dd>
					<dt>Berlaku</dt>
					<dd>Sampai bangkrut</dd>
				</dl>
				<div class="photo" aria-hidden="true">🛵</div>
			</div>
		</div>
		<p class="lede">
			Monopoli online untuk 2–6 orang. Beli kota, kena Musibah, dapat Takdir, bangun rumah, dan
			jangan sampai saldo minus.
		</p>
	</section>

	<section class="panel">
		{#if data.user}
			<div class="who">
				{#if data.user.avatar}<img src={data.user.avatar} alt="" referrerpolicy="no-referrer" />{/if}
				<span>Halo, <strong>{data.user.name}</strong></span>
				<form method="POST" action="/auth/logout"><button class="link">Keluar</button></form>
			</div>
			{#if next !== '/'}
				<a class="btn primary big" href={next}>Lanjut ke room undangan</a>
			{/if}
			<button class="btn primary big" onclick={createRoom} disabled={busy}>
				{busy ? 'Membuat room…' : 'Buat room baru'}
			</button>
			<form class="join" onsubmit={joinRoom}>
				<label for="code">Punya kode undangan?</label>
				<div class="row">
					<input id="code" bind:value={joinCode} placeholder="ABC123" maxlength="6" autocomplete="off" />
					<button class="btn">Gabung</button>
				</div>
			</form>
		{:else}
			{#if next !== '/'}<p class="invite">Kamu diundang main! Masuk dulu untuk bergabung.</p>{/if}
			{#if data.googleEnabled}
				<a class="btn primary big" href={`/auth/google?next=${encodeURIComponent(next)}`}>
					<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg>
					Masuk dengan Google
				</a>
			{:else}
				<p class="warn">Login Google belum dikonfigurasi. Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET di .env.</p>
			{/if}
			{#if data.devLogin}
				<form class="join" method="POST" action="/auth/dev">
					<label for="name">Mode testing: masuk sebagai tamu</label>
					<input type="hidden" name="next" value={next} />
					<div class="row">
						<input id="name" name="name" placeholder="Nama kamu" maxlength="30" />
						<button class="btn">Masuk</button>
					</div>
				</form>
			{/if}
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</section>

	<section class="levels" aria-label="Level rumah">
		{#each HOUSE_LEVELS.slice(1) as lvl, i}
			<div class="lvl" style:--h={`${40 + i * 18}px`}>
				<span class="ico">{lvl.icon}</span>
				<span>{lvl.name}</span>
			</div>
		{/each}
	</section>
</main>

<style>
	main {
		max-width: 980px;
		margin: 0 auto;
		padding: 3rem 1rem 4rem;
		display: grid;
		grid-template-columns: 1.3fr 1fr;
		gap: 2.5rem;
		align-items: start;
	}
	.hero {
		display: grid;
		gap: 1.5rem;
	}
	.ktp {
		background: linear-gradient(160deg, #e9f6f9, #b7dce5 70%, #a6d1dc);
		border: 2px solid var(--ink);
		border-radius: 18px;
		box-shadow: 8px 8px 0 var(--ink);
		overflow: hidden;
		transform: rotate(-1.5deg);
	}
	.ktp-head {
		display: flex;
		justify-content: space-between;
		padding: 0.6rem 1rem;
		font-weight: 700;
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		background: var(--merah);
		color: #fff;
	}
	.ktp-body {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem 1rem;
		padding: 1rem 1.25rem 1.4rem;
	}
	h1 {
		grid-column: 1 / -1;
		margin: 0;
		font-size: clamp(3rem, 9vw, 5.5rem);
		line-height: 0.9;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 0.75rem;
		font-size: 0.95rem;
	}
	dt {
		color: var(--ink-soft);
	}
	dt::after {
		content: ' :';
	}
	dd {
		margin: 0;
		font-weight: 700;
	}
	.photo {
		width: 92px;
		height: 116px;
		border: 2px solid var(--ink);
		background: var(--merah);
		display: grid;
		place-items: center;
		font-size: 3rem;
		border-radius: 4px;
		align-self: end;
	}
	.lede {
		font-size: 1.2rem;
		line-height: 1.45;
		max-width: 46ch;
		margin: 0;
	}
	.panel {
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: var(--radius-m);
		padding: 1.5rem;
		display: grid;
		gap: 1rem;
		margin-top: 1rem;
	}
	.big {
		padding: 0.85rem 1.2rem;
		font-size: 1.1rem;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.who img {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 2px solid var(--ink);
	}
	.who form {
		margin-left: auto;
	}
	.link {
		background: none;
		border: 0;
		color: var(--merah);
		text-decoration: underline;
		font-weight: 700;
	}
	.join {
		display: grid;
		gap: 0.4rem;
	}
	.join label {
		font-weight: 700;
		font-size: 0.95rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	.row input {
		flex: 1;
		min-width: 0;
		text-transform: uppercase;
	}
	#name {
		text-transform: none;
	}
	.invite {
		margin: 0;
		font-weight: 700;
		background: var(--angkot);
		padding: 0.6rem 0.8rem;
		border-radius: var(--radius-s);
	}
	.warn,
	.error {
		margin: 0;
		color: var(--merah-deep);
		font-weight: 600;
	}
	.levels {
		grid-column: 1 / -1;
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		border-bottom: 3px solid var(--ink);
		padding-bottom: 0.5rem;
		overflow-x: auto;
	}
	.lvl {
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		font-weight: 700;
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.ico {
		font-size: var(--h);
		line-height: 1;
	}
	@media (max-width: 760px) {
		main {
			grid-template-columns: 1fr;
			padding-top: 1.5rem;
		}
		.ktp {
			transform: none;
		}
	}
</style>
