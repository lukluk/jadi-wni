<script>
	import { onMount } from 'svelte';
	import { getSocket } from '$lib/socket.js';

	const INTERVAL = 5 * 60_000;
	/** @type {{ feed: {posts:{handle:string,text:string,kind:string}[], at:number, nextAt:number}|null }} */
	let feed = $state(null);
	let open = $state(false);
	let unseen = $state(false);
	let now = $state(Date.now());
	let offset = 0;

	// ring: sisa waktu menuju update berikutnya
	const pct = $derived(feed?.nextAt ? Math.min(100, Math.max(0, 100 - ((feed.nextAt - now) / INTERVAL) * 100)) : 0);
	const ago = $derived(feed?.at ? Math.max(0, Math.round((now - feed.at) / 60_000)) : 0);

	onMount(() => {
		const s = getSocket();
		const onFeed = (f) => {
			if (f?.at && f.at !== feed?.at && !open) unseen = true;
			feed = f;
		};
		s.on('netizen:feed', onFeed);
		s.emit('netizen:query', null, (f) => f && !feed && (feed = f));
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => {
			s.off('netizen:feed', onFeed);
			clearInterval(t);
		};
	});

	function toggle() {
		open = !open;
		if (open) unseen = false;
	}
</script>

{#if feed}
	{#if open}
		<section class="panel" aria-label="Netizen">
			<header>
				<b>Netizen lagi rame 🔥</b>
				<button class="x" onclick={toggle} aria-label="Tutup">✕</button>
			</header>
			<div class="list">
				{#each feed.posts as p}
					<article class={p.kind}>
						<b>{p.handle}</b>{#if p.kind !== 'komentar'}<span class="tag {p.kind}">{p.kind}</span>{/if}
						<p>{p.text}</p>
					</article>
				{:else}
					<p class="empty">Netizen belum nongol. Mereka muncul tiap 5 menit selama game berjalan.</p>
				{/each}
			</div>
			{#if feed.at}<footer>Diperbarui {ago} menit lalu</footer>{/if}
		</section>
	{/if}
	<button
		class="ring"
		style="--p:{pct}%"
		onclick={toggle}
		aria-label="Netizen X"
		title="Netizen mengomentari para pemain (update tiap 5 menit)"
	>
		<img src="/x.png" alt="" />
		{#if unseen}<span class="dot"></span>{/if}
	</button>
{/if}

<style>
	.ring {
		position: fixed;
		left: 3.9rem;
		bottom: 3.6rem;
		z-index: 60;
		width: 2.9rem;
		height: 2.9rem;
		padding: 3px;
		border-radius: 50%;
		border: 2px solid var(--ink);
		background: conic-gradient(#1d9bf0 var(--p), #d5d9e0 0);
		box-shadow: 2px 2px 0 var(--ink);
		cursor: pointer;
	}
	.ring img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		display: block;
		border: 2px solid #fff;
		box-sizing: border-box;
	}
	.dot {
		position: absolute;
		top: -3px;
		right: -3px;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		background: var(--merah);
		border: 2px solid #fff;
	}
	.panel {
		position: fixed;
		left: 3.9rem;
		bottom: 7rem;
		z-index: 61;
		width: min(22rem, calc(100vw - 5rem));
		max-height: min(26rem, 60vh);
		display: flex;
		flex-direction: column;
		background: #fff;
		border: 2px solid var(--ink);
		border-radius: 12px;
		box-shadow: 3px 3px 0 var(--ink);
		overflow: hidden;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.6rem;
		background: #000;
		color: #fff;
		font-size: 0.85rem;
	}
	.x {
		background: none;
		border: 0;
		color: #fff;
		cursor: pointer;
		font-weight: 800;
	}
	.list {
		overflow-y: auto;
		padding: 0.3rem 0.6rem;
	}
	article {
		padding: 0.4rem 0;
		border-bottom: 1px solid #e3e6ec;
		font-size: 0.8rem;
	}
	article b {
		color: #1d9bf0;
	}
	article p {
		margin: 0.1rem 0 0;
		overflow-wrap: anywhere;
	}
	article.saran p {
		background: #fff7d6;
		border-radius: 6px;
		padding: 0.2rem 0.35rem;
	}
	article.selamat p {
		background: #dff6e6;
		border-radius: 6px;
		padding: 0.2rem 0.35rem;
	}
	article.berita p {
		background: #14213d;
		color: #fff;
		border-radius: 6px;
		padding: 0.2rem 0.35rem;
		font-weight: 700;
	}
	.tag.selamat {
		background: #5cc98a;
	}
	.tag.berita {
		background: #14213d;
		color: #fff;
	}
	.tag {
		margin-left: 0.35rem;
		font-size: 0.65rem;
		font-weight: 800;
		background: #f5c518;
		border-radius: 999px;
		padding: 0 0.4rem;
	}
	@media (max-width: 520px) {
		.ring {
			left: auto;
			right: 0.75rem;
			bottom: 0.75rem;
			width: 2.6rem;
			height: 2.6rem;
		}
		.panel {
			left: 0.75rem;
			right: 0.75rem;
			bottom: 4rem;
			width: auto;
			max-height: 55vh;
		}
	}
	.empty,
	footer {
		font-size: 0.75rem;
		color: var(--ink-soft);
		padding: 0.4rem 0.6rem;
	}
</style>
