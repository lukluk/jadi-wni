<script>
	import {
		TILES,
		GROUPS,
		HOUSE_LEVELS,
		MAX_LEVEL,
		STATION_RENT,
		UTILITY_MULT,
		formatRp
	} from '$lib/shared/board.js';

	/** @type {{ game:any, index:number, meId:string, onAction:(a:any)=>void, onClose:()=>void }} */
	let { game, index, meId, onAction, onClose } = $props();

	const t = $derived(TILES[index]);
	const own = $derived(game.tiles[index]);
	const owner = $derived(own ? game.players.find((p) => p.id === own.owner) : null);
	const mine = $derived(own?.owner === meId && game.status === 'playing');
	const group = $derived(t.group ? GROUPS[t.group] : null);
	const redeem = $derived(t.price ? Math.ceil((t.price / 2) * 1.1) : 0);

	let dialog;
	$effect(() => {
		dialog?.showModal();
	});
</script>

<dialog bind:this={dialog} onclose={onClose} onclick={(e) => e.target === dialog && dialog.close()}>
	<div class="sheet">
		<header style:background={group?.color ?? 'var(--angkot)'} class:dark={group && ['navy', 'merah', 'hijau', 'coklat', 'pink'].includes(t.group)}>
			{#if group}<small>{group.label}</small>{/if}
			<h2>{t.name}</h2>
		</header>

		<div class="content">
			{#if t.desc}<p>{t.desc}</p>{/if}
			{#if t.type === 'musibah'}<p>Ambil kartu Musibah. Siap-siap keluar uang.</p>{/if}
			{#if t.type === 'takdir'}<p>Ambil kartu Takdir. Biasanya rezeki, kadang perjalanan.</p>{/if}
			{#if t.type === 'arisan'}<p>Kas Arisan sekarang: <strong>{formatRp(game.arisan)}</strong></p>{/if}

			{#if t.type === 'property'}
				<table>
					<tbody>
						<tr class:cur={own && own.level === 0}>
							<th>Tanah kosong</th><td>{formatRp(t.rent[0])}</td>
						</tr>
						<tr><th class="note" colspan="2">Sewa dobel kalau kuasai semua kota di grup</th></tr>
						{#each HOUSE_LEVELS.slice(1) as lvl, k}
							<tr class:cur={own?.level === k + 1}>
								<th>{lvl.icon} {lvl.name}</th><td>{formatRp(t.rent[k + 1])}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="meta">Harga {formatRp(t.price)} · Bangun per level {formatRp(group.houseCost)} · Gadai {formatRp(t.price / 2)}</p>
			{:else if t.type === 'station'}
				<table>
					<tbody>
						{#each STATION_RENT.slice(1) as r, k}
							<tr><th>Punya {k + 1} stasiun</th><td>{formatRp(r)}</td></tr>
						{/each}
					</tbody>
				</table>
				<p class="meta">Harga {formatRp(t.price)} · Gadai {formatRp(t.price / 2)}</p>
			{:else if t.type === 'utility'}
				<table>
					<tbody>
						<tr><th>Punya 1 (PLN/PDAM)</th><td>{UTILITY_MULT[1]}× angka dadu</td></tr>
						<tr><th>Punya keduanya</th><td>{UTILITY_MULT[2]}× angka dadu</td></tr>
					</tbody>
				</table>
				<p class="meta">Harga {formatRp(t.price)} · Gadai {formatRp(t.price / 2)}</p>
			{/if}

			{#if owner}
				<p class="owner">
					<span class="dot" style:background={owner.color}></span>
					Milik <strong>{owner.name}</strong>
					{#if own.mortgaged}· sedang digadai{/if}
					{#if own.level}· {HOUSE_LEVELS[own.level].name}{/if}
				</p>
			{:else if t.price}
				<p class="owner">Belum ada pemilik.</p>
			{/if}

			{#if mine}
				<div class="actions">
					{#if t.type === 'property' && !own.mortgaged && own.level < MAX_LEVEL}
						<button class="btn primary small" onclick={() => onAction({ type: 'build', tile: index })}>
							Bangun {HOUSE_LEVELS[own.level + 1].name} ({formatRp(group.houseCost)})
						</button>
					{/if}
					{#if t.type === 'property' && own.level > 0}
						<button class="btn small" onclick={() => onAction({ type: 'sell', tile: index })}>
							Jual {HOUSE_LEVELS[own.level].name} (+{formatRp(group.houseCost / 2)})
						</button>
					{/if}
					{#if !own.mortgaged && own.level === 0}
						<button class="btn small" onclick={() => onAction({ type: 'mortgage', tile: index })}>
							Gadai (+{formatRp(t.price / 2)})
						</button>
					{/if}
					{#if own.mortgaged}
						<button class="btn yellow small" onclick={() => onAction({ type: 'unmortgage', tile: index })}>
							Tebus ({formatRp(redeem)})
						</button>
					{/if}
				</div>
			{/if}
		</div>
		<button class="close" onclick={() => dialog.close()} aria-label="Tutup">✕</button>
	</div>
</dialog>

<style>
	dialog {
		border: 0;
		padding: 0;
		background: transparent;
		max-width: min(420px, calc(100vw - 2rem));
		width: 100%;
	}
	dialog::backdrop {
		background: rgba(20, 33, 61, 0.45);
	}
	.sheet {
		position: relative;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: var(--radius-m);
		box-shadow: 6px 6px 0 var(--ink);
		overflow: hidden;
	}
	header {
		padding: 0.9rem 1.1rem;
		border-bottom: 3px solid var(--ink);
	}
	header.dark {
		color: #fff;
	}
	header small {
		font-weight: 700;
		opacity: 0.85;
	}
	h2 {
		margin: 0;
		font-size: 1.7rem;
		line-height: 1.05;
	}
	.content {
		padding: 1rem 1.1rem 1.2rem;
		display: grid;
		gap: 0.7rem;
	}
	p {
		margin: 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0.3rem 0.2rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
		font-weight: 500;
	}
	td {
		text-align: right;
		font-weight: 700;
	}
	th.note {
		font-size: 0.8rem;
		color: var(--ink-soft);
	}
	tr.cur {
		background: #fff3c4;
	}
	.meta {
		font-size: 0.85rem;
		color: var(--ink-soft);
	}
	.owner {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid var(--ink);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.close {
		position: absolute;
		top: 0.5rem;
		right: 0.6rem;
		border: 0;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 50%;
		width: 30px;
		height: 30px;
		font-weight: 700;
	}
</style>
