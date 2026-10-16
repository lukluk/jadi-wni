<script>
	import { onMount } from 'svelte';
	import { getSocket } from '$lib/socket.js';

	/** @type {{ feed: {posts:{handle:string,text:string,kind:string}[], at:number, nextAt:number}|null }} */
	let feed = $state(null);
	let paused = $state(false);
	let now = $state(Date.now());

	const posts = $derived(feed?.posts ?? []);
	const ago = $derived(feed?.at ? Math.max(0, Math.round((now - feed.at) / 60_000)) : 0);
	// kecepatan tetap ~13 karakter/detik, minimal 30 dtk per putaran
	const duration = $derived(Math.max(30, posts.reduce((n, p) => n + p.handle.length + p.text.length + 6, 0) / 13));

	onMount(() => {
		const s = getSocket();
		const onFeed = (f) => (feed = f);
		s.on('netizen:feed', onFeed);
		s.emit('netizen:query', null, (f) => f && !feed && (feed = f));
		const t = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			s.off('netizen:feed', onFeed);
			clearInterval(t);
		};
	});
</script>

{#if feed}
	<div class="ticker" role="region" aria-label="Netizen">
		<span class="label" title={feed.at ? `Diperbarui ${ago} menit lalu` : 'Netizen mengomentari para pemain (update tiap 5 menit)'}>
			<span class="live"></span>NETIZEN
		</span>
		{#if posts.length}
			<button class="track" onclick={() => (paused = !paused)} title={paused ? 'Lanjutkan' : 'Jeda'} aria-pressed={paused}>
				<span class="run" class:paused style="animation-duration:{duration}s">
					{#each [0, 1] as copy (copy)}
						<span class="set" aria-hidden={copy === 1}>
							{#each posts as p, i (i)}
								<span class="item {p.kind}">
									<b>{p.handle}</b>
									{#if p.kind !== 'komentar'}<em class="tag {p.kind}">{p.kind}</em>{/if}
									{p.text}
								</span>
							{/each}
						</span>
					{/each}
				</span>
			</button>
		{:else}
			<span class="empty">Netizen belum nongol. Mereka muncul tiap 5 menit selama game berjalan.</span>
		{/if}
	</div>
{/if}

<style>
	.ticker {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		height: 2.2rem;
		z-index: 70;
		display: flex;
		align-items: stretch;
		background: #0b1220;
		color: #fff;
		border-top: 2px solid var(--ink);
		padding-right: 8rem; /* ruang untuk tombol Menyerah dan ikon pengaturan di ujung kanan */
		font-size: 0.82rem;
	}
	:global(body:has(.ticker)) {
		--ticker-h: 2.2rem;
		padding-bottom: var(--ticker-h);
	}
	.label {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.8rem;
		background: var(--merah);
		font-weight: 900;
		letter-spacing: 0.06em;
		font-size: 0.75rem;
	}
	.live {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #fff;
		animation: blink 1.2s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.25;
		}
	}
	.track {
		all: unset;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		display: flex;
		align-items: center;
		cursor: pointer;
	}
	.run {
		display: inline-flex;
		flex: none;
		width: max-content;
		animation: scroll linear infinite;
	}
	.run.paused,
	.track:hover .run {
		animation-play-state: paused;
	}
	@keyframes scroll {
		to {
			transform: translateX(-50%);
		}
	}
	.set {
		display: inline-flex;
		flex: none;
	}
	.item {
		white-space: nowrap;
		padding: 0 1.6rem;
		position: relative;
	}
	.item::after {
		content: '•';
		position: absolute;
		right: -0.2rem;
		color: #5b6b8c;
	}
	.item b {
		color: #6cc4ff;
		margin-right: 0.3rem;
	}
	.item.berita {
		font-weight: 700;
		color: #ffe27a;
	}
	.item.selamat {
		color: #8ff0b0;
	}
	.tag {
		font-style: normal;
		font-size: 0.62rem;
		font-weight: 800;
		text-transform: uppercase;
		background: #f5c518;
		color: #000;
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
		margin-right: 0.3rem;
	}
	.tag.selamat {
		background: #5cc98a;
	}
	.tag.berita {
		background: #fff;
	}
	.empty {
		align-self: center;
		padding: 0 0.8rem;
		color: #9fb0cf;
		font-size: 0.78rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	@media (prefers-reduced-motion: reduce) {
		.run {
			animation: none;
		}
		.track {
			overflow-x: auto;
		}
		.set:nth-child(2) {
			display: none;
		}
	}
</style>
