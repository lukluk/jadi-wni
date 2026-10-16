<script>
	import {
		TILES,
		GROUPS,
		HOUSE_LEVELS,
		MAX_LEVEL,
		SAWIT_LEVEL,
		SAWIT_SALARY_BONUS,
		buildCost,
		STATION_RENT,
		UTILITY_MULT,
		formatRp
	} from '$lib/shared/board.js';

	/** @type {{ game:any, images?:Record<string, any>, index:number, meId:string, onAction:(a:any)=>void, onClose:()=>void }} */
	let { game, images = {}, index, meId, onAction, onClose } = $props();
	const photo = $derived(images[TILES[index].name]);

	const t = $derived(TILES[index]);
	const own = $derived(game.tiles[index]);
	const owner = $derived(own ? game.players.find((p) => p.id === own.owner) : null);
	const mine = $derived(own?.owner === meId && game.status === 'playing');
	const group = $derived(t.group ? GROUPS[t.group] : null);
	const redeem = $derived(t.price ? Math.ceil((t.price / 2) * 1.1) : 0);

	const listing = $derived(game.market?.[index]);
	const offerCount = $derived(Object.keys(listing?.offers ?? {}).length);
	const canList = $derived(
		mine &&
			!own.mortgaged &&
			(t.type !== 'property' || !TILES.some((x) => x.group === t.group && (game.tiles[x.i]?.level ?? 0) > 0))
	);
	let priceDraft = $state(/** @type {string|null} */ (null));
	const askPrice = $derived(priceDraft ?? String(listing?.price ?? t.price ?? ''));
	const askValid = $derived(Number.isFinite(Math.round(Number(askPrice))) && Math.round(Number(askPrice)) >= 1);

	let dialog;
	$effect(() => {
		dialog?.showModal();
	});
</script>

<dialog bind:this={dialog} onclose={onClose} onclick={(e) => e.target === dialog && dialog.close()}>
	<div class="sheet">
		{#if photo}
			<figure class="photo">
				<img src={photo.url} alt={`Foto ${t.name}`} referrerpolicy="no-referrer" />
				<figcaption>
					Foto: <a href={photo.page} target="_blank" rel="noopener">{photo.credit}</a>{photo.license ? `, ${photo.license}` : ''}
				</figcaption>
			</figure>
		{/if}
		<header style:background={group?.color ?? 'var(--angkot)'} class:dark={group && ['navy', 'merah', 'hijau', 'coklat', 'pink'].includes(t.group)}>
			{#if group}<small>{group.label}</small>{/if}
			<h2>{t.name}</h2>
		</header>

		<div class="content">
			{#if t.desc}<p>{t.desc}</p>{/if}
			{#if t.type === 'musibah'}<p>Ambil kartu Musibah. Siap-siap keluar uang.</p>{/if}
			{#if t.type === 'takdir'}<p>Ambil kartu Takdir. Biasanya rezeki, kadang perjalanan.</p>{/if}
			{#if t.type === 'bansos'}<p>Kas Negara sekarang: <strong>{formatRp(game.kasNegara)}</strong></p>{/if}

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
				<p class="meta">Harga {formatRp(t.price)} · Bangun per level {formatRp(group.houseCost)} · Kebun Sawit {formatRp(buildCost(group.houseCost, SAWIT_LEVEL))} (+{formatRp(SAWIT_SALARY_BONUS)} gaji GAJIAN) · Gadai {formatRp(t.price / 2)}</p>
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

			{#if listing}
				<p class="listed">
					🏷️ Dijual di Pasar: <strong>{formatRp(listing.price)}</strong>
					{#if mine}{offerCount ? `· ${offerCount} tawaran, cek tab Pasar` : '· belum ada tawaran'}
					{:else}· beli atau nego di tab Pasar{/if}
				</p>
			{/if}

			{#if canList}
				<form
					class="sellform"
					onsubmit={(e) => {
						e.preventDefault();
						onAction({ type: 'mkList', tile: index, price: Math.round(Number(askPrice)) });
					}}
				>
					<label>
						<span>{listing ? 'Harga jual (jt)' : 'Jual di Pasar (jt)'}</span>
						<input
							type="number"
							min="1"
							inputmode="numeric"
							value={askPrice}
							oninput={(e) => (priceDraft = e.currentTarget.value)}
						/>
					</label>
					<button class="btn primary small" disabled={!askValid}>{listing ? 'Ubah harga' : 'Jual'}</button>
					{#if listing}
						<button type="button" class="btn small" onclick={() => onAction({ type: 'mkUnlist', tile: index })}>Tarik</button>
					{/if}
				</form>
			{:else if mine && listing}
				<div class="actions">
					<button class="btn small" onclick={() => onAction({ type: 'mkUnlist', tile: index })}>Tarik dari Pasar</button>
				</div>
			{/if}

			{#if mine}
				<div class="actions">
					{#if t.type === 'property' && !own.mortgaged && own.level < MAX_LEVEL}
						<button class="btn primary small" onclick={() => onAction({ type: 'build', tile: index })}>
							Bangun {HOUSE_LEVELS[own.level + 1].name} ({formatRp(buildCost(group.houseCost, own.level + 1))})
						</button>
					{/if}
					{#if t.type === 'property' && own.level > 0}
						<button class="btn small" onclick={() => onAction({ type: 'sell', tile: index })}>
							Jual {HOUSE_LEVELS[own.level].name} (+{formatRp(buildCost(group.houseCost, own.level) / 2)})
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
	.listed {
		margin: 0.4rem 0 0;
		padding: 0.35rem 0.6rem;
		background: #fff8d6;
		border: 2px solid var(--ink);
		border-radius: 8px;
		font-size: 0.85rem;
	}
	.sellform {
		display: flex;
		gap: 0.4rem;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.sellform label {
		flex: 1 1 8rem;
		display: grid;
		gap: 0.15rem;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.sellform input {
		min-width: 0;
		padding: 0.3rem 0.5rem;
	}
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
	.photo {
		margin: 0;
		position: relative;
		height: 160px;
		border-bottom: 3px solid var(--ink);
		background: var(--ink);
	}
	.photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.photo figcaption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 0.25rem 0.6rem;
		font-size: 0.7rem;
		color: #fff;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
	}
	.photo figcaption a {
		color: #fff;
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
