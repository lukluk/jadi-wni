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

<!-- Pemandangan: langit, awan, matahari, bukit -->
<div class="scene" aria-hidden="true">
	<div class="sun"></div>
	<div class="clouds">
		<span class="cloud c1"></span>
		<span class="cloud c2"></span>
		<span class="cloud c3"></span>
		<span class="cloud c4"></span>
		<span class="cloud c5"></span>
		<span class="cloud c6"></span>
	</div>
	<div class="birds"><span>︶</span><span>︶</span><span>︶</span></div>
	<svg class="hills" viewBox="0 0 1440 320" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
		<path class="hill-far" d="M0 220 C 180 150 320 170 480 200 C 700 240 820 150 1040 180 C 1240 206 1340 170 1440 190 L1440 320 L0 320 Z" />
		<path class="hill-near" d="M0 260 C 160 210 300 250 460 250 C 680 250 760 210 980 240 C 1180 266 1320 236 1440 250 L1440 320 L0 320 Z" />
	</svg>
	<div class="ground"></div>
</div>

<main>
	<section class="hero">
		<p class="badge">🇮🇩 Monopoli online · 2–6 pemain</p>
		<div class="ktp" aria-label="Kartu identitas permainan">
			<div class="ktp-head">
				<span>PROVINSI SERBA ADA</span>
				<span>KABUPATEN GAJIAN</span>
			</div>
			<div class="ktp-body">
				<span class="nik">NIK 3201 0000 0000 0001</span>
				<h1>Jadi <em>WNI</em></h1>
				<dl>
					<dt>Pekerjaan</dt>
					<dd>Lempar dadu, bayar cicilan</dd>
					<dt>Status</dt>
					<dd>Dari Rumah Subsidi ke Rumah OKB</dd>
					<dt>Berlaku</dt>
					<dd>Sampai bangkrut</dd>
				</dl>
				<div class="photo" aria-hidden="true"><span>🛵</span></div>
			</div>
			<div class="dice" aria-hidden="true"><i>⚀</i><i>⚃</i></div>
		</div>
		<p class="lede">
			Beli kota, kena <b>Musibah</b>, dapat <b>Takdir</b>, bangun rumah, main saham, cobain judol,
			sampai jadi sultan Rp 10 M. Hidup itu keras — untung ada teman.
		</p>
		<ul class="chips" aria-label="Fitur">
			<li>📈 Saham</li>
			<li>🎰 Judol</li>
			<li>🚔 Sogok aparat</li>
			<li>💬 Netizen</li>
		</ul>
	</section>

	<section class="panel">
		<h2>Siap jadi sultan?</h2>
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
				{busy ? 'Membuat room…' : '🎲 Buat room baru'}
			</button>
			<div class="or"><span>atau</span></div>
			<form class="join" onsubmit={joinRoom}>
				<label for="code">Punya kode undangan?</label>
				<div class="row">
					<input id="code" bind:value={joinCode} placeholder="ABC123" maxlength="6" autocomplete="off" />
					<button class="btn yellow">Gabung</button>
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

		<div class="how">
			<div><b>1</b><span>Buat room & bagikan link</span></div>
			<div><b>2</b><span>Lempar dadu, beli & bangun</span></div>
			<div><b>3</b><span>Kaya Rp 10 M = menang</span></div>
		</div>
	</section>

	<section class="levels" aria-label="Level rumah">
		{#each HOUSE_LEVELS.slice(1) as lvl, i}
			<div class="lvl" style:--h={`${34 + i * 15}px`} style:--d={`${i * 0.45}s`}>
				<span class="ico">{lvl.icon}</span>
				<span class="nm">{lvl.name}</span>
			</div>
		{/each}
	</section>
</main>

<style>
	/* ---------- Pemandangan ---------- */
	.scene {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		background: linear-gradient(
			180deg,
			#2a7bc4 0%,
			#53a3dd 28%,
			#8fcbe8 52%,
			#c7e8f3 70%,
			#eaf7ef 86%,
			#f3fbe9 100%
		);
	}
	.sun {
		position: absolute;
		top: 8%;
		right: 12%;
		width: 150px;
		height: 150px;
		border-radius: 50%;
		background: radial-gradient(circle, #fff6d6 0%, #ffe27a 45%, rgba(255, 222, 92, 0) 72%);
		filter: blur(2px);
		animation: pulse 7s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			transform: scale(1.12);
			opacity: 0.9;
		}
	}
	.clouds {
		position: absolute;
		inset: 0;
	}
	.cloud {
		position: absolute;
		left: 0;
		width: 120px;
		height: 40px;
		background: #fff;
		border-radius: 40px;
		opacity: 0.92;
		box-shadow: 0 10px 24px rgba(40, 90, 140, 0.12);
		animation: drift linear infinite;
	}
	.cloud::before,
	.cloud::after {
		content: '';
		position: absolute;
		background: #fff;
		border-radius: 50%;
	}
	.cloud::before {
		width: 56px;
		height: 56px;
		top: -24px;
		left: 16px;
	}
	.cloud::after {
		width: 78px;
		height: 78px;
		top: -40px;
		left: 48px;
	}
	@keyframes drift {
		from {
			transform: translateX(-20vw) scale(var(--s));
		}
		to {
			transform: translateX(118vw) scale(var(--s));
		}
	}
	.c1 {
		top: 9%;
		--s: 0.6;
		opacity: 0.75;
		animation-duration: 72s;
		animation-delay: -12s;
	}
	.c2 {
		top: 17%;
		--s: 1;
		animation-duration: 56s;
		animation-delay: -30s;
	}
	.c3 {
		top: 27%;
		--s: 0.8;
		opacity: 0.85;
		animation-duration: 88s;
		animation-delay: -6s;
	}
	.c4 {
		top: 41%;
		--s: 1.35;
		animation-duration: 50s;
		animation-delay: -22s;
	}
	.c5 {
		top: 56%;
		--s: 0.5;
		opacity: 0.6;
		animation-duration: 98s;
		animation-delay: -64s;
	}
	.c6 {
		top: 13%;
		--s: 1.1;
		opacity: 0.8;
		animation-duration: 64s;
		animation-delay: -46s;
	}
	.birds {
		position: absolute;
		top: 34%;
		left: 0;
		display: flex;
		gap: 10px;
		color: rgba(20, 33, 61, 0.45);
		font-size: 20px;
		animation: fly 60s linear infinite;
	}
	.birds span:nth-child(2) {
		transform: translateY(-6px) scale(0.8);
	}
	.birds span:nth-child(3) {
		transform: translateY(3px) scale(0.9);
	}
	@keyframes fly {
		from {
			transform: translateX(-10vw) translateY(0);
		}
		50% {
			transform: translateX(55vw) translateY(-20px);
		}
		to {
			transform: translateX(120vw) translateY(10px);
		}
	}
	.hills {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 72px;
		width: 100%;
		height: 42vh;
		min-height: 220px;
	}
	.hill-far {
		fill: #bfe3a6;
	}
	.hill-near {
		fill: #86c56a;
	}
	.ground {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 76px;
		background: linear-gradient(180deg, #6fb457, #5a9e46);
		border-top: 3px solid rgba(20, 33, 61, 0.15);
	}

	/* ---------- Tata letak ---------- */
	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 2.5rem 1rem 5rem;
		display: grid;
		grid-template-columns: 1.25fr 1fr;
		gap: 2.5rem;
		align-items: start;
	}
	.hero {
		display: grid;
		gap: 1.3rem;
	}
	.badge {
		justify-self: start;
		margin: 0;
		background: var(--angkot);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.3rem 0.9rem;
		font-weight: 700;
		font-size: 0.85rem;
		box-shadow: 0 3px 0 var(--ink);
	}
	.ktp {
		position: relative;
		background:
			radial-gradient(circle at 85% 18%, rgba(255, 255, 255, 0.7), transparent 42%),
			repeating-linear-gradient(115deg, transparent 0 14px, rgba(20, 33, 61, 0.04) 14px 15px),
			linear-gradient(160deg, #eef9fb, #c0e2ea 72%, #aed6e0);
		border: 2px solid var(--ink);
		border-radius: 18px;
		box-shadow: 10px 10px 0 var(--ink);
		transform: rotate(-1.5deg);
		transition: transform 0.25s;
	}
	.ktp:hover {
		transform: rotate(0.4deg) translateY(-4px);
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
		border-radius: 16px 16px 0 0;
	}
	.ktp-body {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem 1rem;
		padding: 0.8rem 1.25rem 1.4rem;
	}
	.nik {
		grid-column: 1 / -1;
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		font-size: 0.8rem;
		color: var(--ink-soft);
		letter-spacing: 0.08em;
	}
	h1 {
		grid-column: 1 / -1;
		margin: 0 0 0.4rem;
		font-size: clamp(3.2rem, 9vw, 5.4rem);
		line-height: 0.9;
		font-weight: 800;
		letter-spacing: -0.03em;
		text-shadow: 3px 3px 0 rgba(255, 255, 255, 0.7);
	}
	h1 em {
		font-style: normal;
		color: var(--merah);
		text-shadow: 3px 3px 0 var(--ink);
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
		background: linear-gradient(180deg, var(--merah) 50%, #fff 50%);
		display: grid;
		place-items: center;
		border-radius: 4px;
		align-self: end;
		overflow: hidden;
	}
	.photo span {
		font-size: 3rem;
		animation: ride 2.4s ease-in-out infinite;
	}
	@keyframes ride {
		50% {
			transform: translateX(10px) rotate(4deg);
		}
	}
	.dice {
		position: absolute;
		right: -14px;
		bottom: -26px;
		display: flex;
		gap: 4px;
		font-size: 3.4rem;
		line-height: 1;
		filter: drop-shadow(3px 3px 0 var(--ink));
	}
	.dice i {
		font-style: normal;
		background: #fff;
		border: 2px solid var(--ink);
		border-radius: 10px;
		padding: 0 0.1em;
		animation: tumble 3.4s ease-in-out infinite;
	}
	.dice i:last-child {
		animation-delay: 0.6s;
	}
	@keyframes tumble {
		0%,
		60%,
		100% {
			transform: rotate(0);
		}
		75% {
			transform: translateY(-14px) rotate(180deg);
		}
		90% {
			transform: rotate(350deg);
		}
	}
	.lede {
		font-size: 1.15rem;
		line-height: 1.5;
		max-width: 48ch;
		margin: 0.4rem 0 0;
		background: rgba(255, 253, 246, 0.72);
		backdrop-filter: blur(3px);
		border: 2px solid rgba(20, 33, 61, 0.12);
		border-radius: var(--radius-m);
		padding: 0.85rem 1rem;
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chips li {
		background: var(--paper);
		border: 2px solid var(--ink);
		border-radius: 999px;
		padding: 0.28rem 0.85rem;
		font-weight: 700;
		font-size: 0.9rem;
		box-shadow: 0 2px 0 var(--ink);
	}

	/* ---------- Panel login ---------- */
	.panel {
		background: rgba(255, 253, 246, 0.92);
		backdrop-filter: blur(6px);
		border: 2px solid var(--ink);
		border-radius: var(--radius-m);
		box-shadow: 8px 8px 0 var(--ink);
		padding: 1.4rem 1.5rem 1.6rem;
		display: grid;
		gap: 1rem;
		position: relative;
		overflow: hidden;
	}
	.panel::before {
		content: '';
		position: absolute;
		inset: 0 0 auto;
		height: 8px;
		background: repeating-linear-gradient(90deg, var(--merah) 0 22px, #fff 22px 44px);
	}
	h2 {
		margin: 0.4rem 0 0;
		font-size: 1.55rem;
		letter-spacing: -0.02em;
	}
	.big {
		padding: 0.85rem 1.2rem;
		font-size: 1.1rem;
	}
	.or {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		color: var(--ink-soft);
		font-size: 0.85rem;
		font-weight: 700;
	}
	.or::before,
	.or::after {
		content: '';
		flex: 1;
		border-top: 2px dashed var(--line);
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
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		letter-spacing: 0.15em;
	}
	#name {
		text-transform: none;
		font-family: inherit;
		letter-spacing: normal;
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
	.how {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.3rem;
		padding-top: 0.9rem;
		border-top: 2px dashed var(--line);
	}
	.how div {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		font-weight: 600;
		font-size: 0.95rem;
	}
	.how b {
		flex: none;
		width: 1.9rem;
		height: 1.9rem;
		display: grid;
		place-items: center;
		background: var(--angkot);
		border: 2px solid var(--ink);
		border-radius: 50%;
		font-size: 1rem;
	}

	/* ---------- Deretan rumah di atas tanah ---------- */
	.levels {
		grid-column: 1 / -1;
		margin-top: 1.5rem;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		flex-wrap: wrap;
		gap: 1rem 1.6rem;
	}
	.lvl {
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		font-weight: 700;
		font-size: 0.85rem;
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
		white-space: nowrap;
		animation: bob 3s ease-in-out infinite var(--d);
	}
	@keyframes bob {
		50% {
			transform: translateY(-6px);
		}
	}
	.ico {
		font-size: var(--h);
		line-height: 1;
		filter: drop-shadow(0 4px 3px rgba(20, 33, 61, 0.25));
	}
	.nm {
		background: rgba(255, 253, 246, 0.8);
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
	}

	@media (max-width: 820px) {
		main {
			grid-template-columns: 1fr;
			padding-top: 1.5rem;
		}
		.hills {
			height: 32vh;
		}
		.ktp,
		.ktp:hover {
			transform: none;
		}
		.dice {
			right: -6px;
			font-size: 2.6rem;
		}
	}
</style>
