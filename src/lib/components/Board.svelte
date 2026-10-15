<script>
	import { TILES, GROUPS, HOUSE_LEVELS, TOKENS, formatRp } from '$lib/shared/board.js';
	import { tilePos, isCorner } from '$lib/layout.js';

	/** @type {{ game: any, images?: Record<string, any>, onTile: (i:number)=>void, center: import('svelte').Snippet }} */
	let { game, images = {}, onTile, center } = $props();

	const tokenIcon = (id) => TOKENS.find((t) => t.id === id)?.icon ?? '❓';
	const playerById = $derived(Object.fromEntries(game.players.map((p) => [p.id, p])));

	const CORNER_ICON = { start: '💰', jail: '⚖️', bansos: '🏛️', gotojail: '🚔' };
	const TYPE_ICON = { station: '🚆', utility: '', tax: '🧾', musibah: '⚡', takdir: '🍀' };
	const UTIL_ICON = { PLN: '💡', PDAM: '🚰' };

	/** offset bidak supaya tidak menumpuk */
	function tokenStyle(p, idxInTile, countInTile) {
		const { row, col } = tilePos(p.pos);
		const spread = countInTile > 1 ? 0.28 : 0;
		const angle = (idxInTile / countInTile) * Math.PI * 2;
		const dx = Math.cos(angle) * spread;
		const dy = Math.sin(angle) * spread;
		return `left:${((col + 0.5 + dx) / 11) * 100}%;top:${((row + 0.55 + dy) / 11) * 100}%;--c:${p.color}`;
	}

	const tokens = $derived.by(() => {
		const byPos = {};
		const live = game.players.filter((p) => !p.bankrupt);
		for (const p of live) (byPos[p.pos] ??= []).push(p.id);
		return live.map((p) => ({ p, k: byPos[p.pos].indexOf(p.id), n: byPos[p.pos].length }));
	});
	const currentId = $derived(game.status === 'playing' ? game.players[game.turn]?.id : null);
</script>

<div class="board" role="group" aria-label="Papan permainan">
	{#each TILES as t (t.i)}
		{@const pos = tilePos(t.i)}
		{@const own = game.tiles[t.i]}
		{@const owner = own ? playerById[own.owner] : null}
		<button
			class="tile side-{pos.side} type-{t.type}"
			class:corner={isCorner(t.i)}
			class:mortgaged={own?.mortgaged}
			class:pending={game.pendingBuy === t.i}
			style:grid-row={pos.row + 1}
			style:grid-column={pos.col + 1}
			style:--owner={owner?.color ?? 'transparent'}
			onclick={() => onTile(t.i)}
			aria-label={t.name}
		>
			{#if t.group}<span class="band" style:background={GROUPS[t.group].color}>
					{#if own?.level}<span class="lvl" title={HOUSE_LEVELS[own.level].name}>{HOUSE_LEVELS[own.level].icon}</span>{/if}
				</span>{/if}
			<span class="body" class:photo={!!images[t.name]} style:--img={images[t.name] ? `url("${images[t.name].url}")` : null}>
				{#if isCorner(t.i)}<span class="cicon">{CORNER_ICON[t.type]}</span>{/if}
				{#if TYPE_ICON[t.type] || UTIL_ICON[t.name]}<span class="ticon">{TYPE_ICON[t.type] || UTIL_ICON[t.name]}</span>{/if}
				<span class="name">{t.short ?? t.name}</span>
				{#if t.price && !own}<span class="price">{t.price}</span>{/if}
				{#if t.type === 'tax'}<span class="price">-{t.amount}</span>{/if}
			</span>
			{#if owner}<span class="ownerbar" title={`Milik ${owner.name}`}></span>{/if}
		</button>
	{/each}

	<div class="center">
		{@render center()}
	</div>

	{#each tokens as { p, k, n } (p.id)}
		<span class="token" class:active={p.id === currentId} style={tokenStyle(p, k, n)} title={p.name}>
			{tokenIcon(p.token)}
		</span>
	{/each}
</div>

<style>
	.board {
		position: relative;
		display: grid;
		grid-template-columns: repeat(11, 1fr);
		grid-template-rows: repeat(11, 1fr);
		aspect-ratio: 1;
		width: 100%;
		background: var(--ink);
		gap: 1px;
		border: 3px solid var(--ink);
		border-radius: 10px;
		overflow: hidden;
		container-type: inline-size;
	}
	.tile {
		all: unset;
		box-sizing: border-box;
		cursor: pointer;
		background: var(--paper);
		display: flex;
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.tile:focus-visible {
		outline: 3px solid var(--angkot);
		outline-offset: -3px;
		z-index: 2;
	}
	.tile:hover {
		background: #fff6cf;
	}
	.side-b {
		flex-direction: column;
	}
	.side-t {
		flex-direction: column-reverse;
	}
	.side-l {
		flex-direction: row-reverse;
	}
	.side-r {
		flex-direction: row;
	}
	.band {
		flex: 0 0 24%;
		display: grid;
		place-items: center;
	}
	.lvl {
		font-size: clamp(7px, 2.2cqi, 16px);
		line-height: 1;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.4));
	}
	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		padding: 2px;
		text-align: center;
		min-width: 0;
	}
	.body.photo {
		background:
			linear-gradient(rgba(255, 253, 246, 0.5), rgba(255, 253, 246, 0.72)),
			var(--img) center / cover no-repeat;
	}
	.body.photo .name,
	.body.photo .price {
		text-shadow:
			0 0 3px #fff,
			0 0 6px #fff;
	}
	.side-l .body,
	.side-r .body {
		writing-mode: horizontal-tb;
	}
	.name {
		font-size: clamp(6px, 1.45cqi, 12px);
		font-weight: 700;
		line-height: 1.05;
		overflow-wrap: normal;
		word-break: normal;
		hyphens: manual;
	}
	.side-l .band,
	.side-r .band {
		flex-basis: 15%;
	}
	.side-l .name,
	.side-r .name {
		font-size: clamp(5.5px, 1.3cqi, 11px);
	}
	.price {
		font-size: clamp(6px, 1.25cqi, 11px);
		color: var(--ink-soft);
	}
	.ticon {
		font-size: clamp(8px, 2.3cqi, 18px);
		line-height: 1;
	}
	.cicon {
		font-size: clamp(10px, 3.4cqi, 28px);
		line-height: 1;
	}
	.corner {
		background: var(--angkot);
	}
	.corner .name {
		font-size: clamp(6px, 1.5cqi, 13px);
	}
	.type-gotojail,
	.type-jail {
		background: #ffd9d9;
	}
	.type-musibah {
		background: #fde4e7;
	}
	.type-takdir {
		background: #fff3c4;
	}
	.ownerbar {
		position: absolute;
		background: var(--owner);
	}
	.side-b .ownerbar {
		left: 0;
		right: 0;
		bottom: 0;
		height: 14%;
	}
	.side-t .ownerbar {
		left: 0;
		right: 0;
		top: 0;
		height: 14%;
	}
	.side-l .ownerbar {
		top: 0;
		bottom: 0;
		left: 0;
		width: 14%;
	}
	.side-r .ownerbar {
		top: 0;
		bottom: 0;
		right: 0;
		width: 14%;
	}
	.mortgaged .body {
		opacity: 0.4;
		background: repeating-linear-gradient(45deg, transparent 0 4px, rgba(20, 33, 61, 0.15) 4px 6px);
	}
	.pending {
		animation: pulse 1s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		to {
			background: #ffe680;
		}
	}
	.center {
		grid-row: 2 / 11;
		grid-column: 2 / 11;
		background:
			radial-gradient(circle at 50% 40%, #e8f5f8, var(--ktp) 70%);
		display: grid;
		place-items: center;
		padding: 3%;
		min-height: 0;
		overflow: auto;
	}
	.token {
		position: absolute;
		transform: translate(-50%, -50%);
		width: clamp(16px, 5cqi, 38px);
		height: clamp(16px, 5cqi, 38px);
		border-radius: 50%;
		background: #fff;
		border: 3px solid var(--c);
		display: grid;
		place-items: center;
		font-size: clamp(9px, 2.9cqi, 22px);
		line-height: 1;
		box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
		transition:
			left 0.45s cubic-bezier(0.5, 0, 0.3, 1.2),
			top 0.45s cubic-bezier(0.5, 0, 0.3, 1.2);
		pointer-events: none;
		z-index: 3;
	}
	.token.active {
		box-shadow:
			0 0 0 3px var(--angkot),
			0 2px 0 rgba(0, 0, 0, 0.35);
		z-index: 4;
	}
</style>
