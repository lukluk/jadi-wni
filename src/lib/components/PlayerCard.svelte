<script>
	import { TOKENS, TILES, formatRp } from '$lib/shared/board.js';

	/** @type {{ p:any, game:any, isTurn:boolean, isMe:boolean, online:boolean, isHost:boolean }} */
	let { p, game, isTurn, isMe, online, isHost } = $props();

	const token = $derived(TOKENS.find((t) => t.id === p.token));
	const owned = $derived(Object.values(game.tiles).filter((t) => t.owner === p.id).length);
	const status = $derived(
		p.bankrupt
			? 'Bangkrut'
			: p.inJail
				? `Di Ruang Sidang (${p.jailTurns}/3)`
				: game.status === 'lobby'
					? 'Siap main'
					: `Di ${TILES[p.pos].name}`
	);
</script>

<article class="ktp" class:turn={isTurn} class:bankrupt={p.bankrupt} style:--c={p.color}>
	<div class="photo" aria-hidden="true">
		{#if p.avatar}<img src={p.avatar} alt="" referrerpolicy="no-referrer" />{/if}
		<span class="tok">{token?.icon}</span>
	</div>
	<div class="info">
		<div class="name">
			<span class="online" class:on={online} title={online ? 'Online' : 'Offline'}></span>
			<strong>{p.name}</strong>
			{#if isMe}<span class="tag">kamu</span>{/if}
			{#if isHost}<span class="tag">host</span>{/if}
		</div>
		<div class="status">{status}</div>
		{#if game.status !== 'lobby'}
			<div class="nums">
				<span class="money" class:neg={p.money < 0}>{formatRp(p.money)}</span>
				<span class="props">{owned} aset{p.jailFree ? ` · ${p.jailFree} Pemutihan` : ''}</span>
			</div>
		{/if}
	</div>
</article>

<style>
	.ktp {
		display: grid;
		grid-template-columns: 52px 1fr;
		gap: 0.65rem;
		align-items: center;
		background: linear-gradient(160deg, #eef8fa, #c6e3ea);
		border: 2px solid var(--ink);
		border-left: 8px solid var(--c);
		border-radius: 10px;
		padding: 0.5rem 0.65rem;
		transition: transform 0.15s;
	}
	.turn {
		background: linear-gradient(160deg, #fff8d6, #f6d74a);
		transform: translateX(4px);
		box-shadow: -4px 4px 0 var(--ink);
	}
	.bankrupt {
		filter: grayscale(1);
		opacity: 0.55;
	}
	.photo {
		position: relative;
		width: 52px;
		height: 60px;
		background: var(--c);
		border: 2px solid var(--ink);
		border-radius: 4px;
		display: grid;
		place-items: center;
		overflow: hidden;
	}
	.photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.tok {
		position: absolute;
		right: 1px;
		bottom: 1px;
		font-size: 1.15rem;
		background: #fff;
		border-radius: 50%;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		line-height: 1;
	}
	.photo:not(:has(img)) .tok {
		position: static;
		width: auto;
		height: auto;
		background: none;
		font-size: 1.8rem;
	}
	.info {
		min-width: 0;
		display: grid;
		gap: 0.1rem;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.name strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.online {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #9aa3b5;
	}
	.online.on {
		background: var(--ok);
	}
	.tag {
		flex: none;
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--ink);
		color: #fff;
		padding: 0 0.35rem;
		border-radius: 4px;
	}
	.status {
		font-size: 0.82rem;
		color: var(--ink-soft);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nums {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.money {
		font-weight: 800;
		font-size: 1.05rem;
	}
	.money.neg {
		color: var(--merah);
	}
	.props {
		font-size: 0.78rem;
		color: var(--ink-soft);
		white-space: nowrap;
	}
</style>
