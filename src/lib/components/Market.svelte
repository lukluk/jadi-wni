<script>
	import { GROUPS, formatRp, isCardKey, listingTile } from '$lib/shared/board.js';

	/** @type {{ game:any, meId:string, onAction:(a:any)=>void, onTile:(i:number)=>void }} */
	let { game, meId, onAction, onTile } = $props();

	const me = $derived(game.players.find((p) => p.id === meId && !p.bankrupt));
	const nameOf = (id) => game.players.find((p) => p.id === id)?.name ?? '?';
	const colorOf = (id) => game.players.find((p) => p.id === id)?.color ?? '#999';
	const playing = $derived(game.status === 'playing');

	const listings = $derived(
		Object.entries(game.market ?? {})
			.map(([i, l]) => ({ i: isCardKey(i) ? i : +i, tile: listingTile(i), ...l }))
			.sort((a, b) =>
				a.seller === meId ? -1 : b.seller === meId ? 1 : String(a.i).localeCompare(String(b.i), undefined, { numeric: true })
			)
	);

	// draft harga per petak: key "l<i>" ubah harga, "o<i>" tawaran
	let drafts = $state({});
	let nego = $state({}); // petak yang form negonya terbuka

	const draft = (key, fallback) => drafts[key] ?? fallback;
	const num = (v) => Math.round(Number(v));
	const valid = (v) => Number.isFinite(num(v)) && num(v) >= 1;
</script>

<div class="market">
	{#if !playing}
		<p class="empty">Marketplace dibuka setelah game dimulai.</p>
	{:else}
		<h4>Dijual ({listings.length})</h4>
		{#each listings as l (l.i)}
			{@const mineL = l.seller === meId}
			{@const offers = Object.entries(l.offers ?? {})}
			{@const myOffer = l.offers?.[meId]}
			{@const listed = l.price != null}
			{@const negoDefault = myOffer ?? (listed ? Math.round(l.price * 0.8) : (l.tile.price ?? 1))}
			<article class="item" class:mine={mineL}>
				<header>
					<button class="name" onclick={() => !isCardKey(l.i) && onTile(l.i)} title="Lihat detail petak">
						{#if l.tile.group}<i class="band" style:background={GROUPS[l.tile.group].color}></i>{:else if isCardKey(l.i)}🎫{/if}
						{l.tile.name}
						{#if (game.tiles[l.i]?.level ?? 0) > 0}<small>lv {game.tiles[l.i].level}</small>{/if}
					</button>
					<strong class="price">{listed ? formatRp(l.price) : '💬 ditawar'}</strong>
				</header>
				<div class="seller">
					<span class="dot" style:background={colorOf(l.seller)}></span>{mineL ? 'Kamu' : nameOf(l.seller)}
					{#if l.tile.price}<span class="ref">harga dasar {formatRp(l.tile.price)}</span>{/if}
				</div>

				{#if mineL}
					<form
						class="row"
						onsubmit={(e) => {
							e.preventDefault();
							onAction({ type: 'mkList', tile: l.i, price: num(draft('l' + l.i, l.price)) });
						}}
					>
						<input
							type="number"
							min="1"
							inputmode="numeric"
							aria-label={`Harga ${l.tile.name} (jt)`}
							value={draft('l' + l.i, l.price)}
							oninput={(e) => (drafts['l' + l.i] = e.currentTarget.value)}
						/>
						<button class="btn small" disabled={!valid(draft('l' + l.i, l.price))}>{listed ? 'Ubah harga' : 'Pasang harga'}</button>
						<button type="button" class="btn small" onclick={() => onAction({ type: 'mkUnlist', tile: l.i })}>{listed ? 'Tarik' : 'Tolak semua'}</button>
					</form>
					{#if offers.length}
						<ul class="offers">
							{#each offers as [buyer, price]}
								<li>
									<span class="dot" style:background={colorOf(buyer)}></span>
									<span>{nameOf(buyer)} nawar <strong>{formatRp(price)}</strong></span>
									<button class="btn primary small" onclick={() => onAction({ type: 'mkAccept', tile: l.i, buyer })}>Terima</button>
									<button class="btn small" onclick={() => onAction({ type: 'mkReject', tile: l.i, buyer })}>Tolak</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint">Belum ada tawaran.</p>
					{/if}
				{:else if me}
					<div class="row">
						{#if listed}
							<button class="btn primary small" disabled={me.money < l.price} onclick={() => onAction({ type: 'mkBuy', tile: l.i })}>
								Beli {formatRp(l.price)}
							</button>
						{/if}
						<button class="btn small" onclick={() => (nego[l.i] = !nego[l.i])} aria-expanded={!!nego[l.i]}>{myOffer != null ? 'Ubah tawaran' : 'Nego'}</button>
					</div>
					{#if myOffer != null}
						<p class="hint">
							Tawaranmu: <strong>{formatRp(myOffer)}</strong>
							<button class="link" onclick={() => onAction({ type: 'mkCancelOffer', tile: l.i })}>batalkan</button>
						</p>
					{/if}
					{#if nego[l.i]}
						<form
							class="row"
							onsubmit={(e) => {
								e.preventDefault();
								onAction({ type: 'mkOffer', tile: l.i, price: num(draft('o' + l.i, negoDefault)) });
								nego[l.i] = false;
							}}
						>
							<input
								type="number"
								min="1"
								inputmode="numeric"
								aria-label={`Tawaran untuk ${l.tile.name} (jt)`}
								value={draft('o' + l.i, negoDefault)}
								oninput={(e) => (drafts['o' + l.i] = e.currentTarget.value)}
							/>
							<button class="btn yellow small" disabled={!valid(draft('o' + l.i, negoDefault))}>Kirim tawaran</button>
						</form>
					{/if}
				{/if}
			</article>
		{:else}
			<p class="empty">Belum ada aset dijual. Pemilik bisa menjual lewat detail petak (klik petaknya di papan).</p>
		{/each}

	{/if}
</div>

<style>
	.market {
		display: grid;
		gap: 0.5rem;
	}
	h4 {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-soft);
	}
	.empty,
	.hint {
		margin: 0;
		color: var(--ink-soft);
		font-size: 0.82rem;
	}
	.item {
		border: 2px solid var(--ink);
		border-radius: 10px;
		padding: 0.45rem 0.55rem;
		background: #fff;
		display: grid;
		gap: 0.3rem;
	}
	.item.mine {
		background: #fff8d6;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
	}
	.name {
		all: unset;
		cursor: pointer;
		font-weight: 800;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}
	.name:focus-visible {
		outline: 2px solid var(--angkot);
		outline-offset: 2px;
	}
	.name small {
		font-weight: 600;
		color: var(--ink-soft);
	}
	.band {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 2px;
		border: 1px solid var(--ink);
		flex: none;
	}
	.price {
		white-space: nowrap;
	}
	.seller {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8rem;
	}
	.ref {
		margin-left: auto;
		color: var(--ink-soft);
	}
	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		flex: none;
	}
	.row {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.row input {
		flex: 1 1 5rem;
		min-width: 0;
		padding: 0.3rem 0.5rem;
	}
	.offers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.offers li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		font-size: 0.82rem;
	}
	.offers li span:nth-child(2) {
		flex: 1 1 8rem;
	}
	.link {
		all: unset;
		cursor: pointer;
		text-decoration: underline;
		color: var(--merah);
	}
</style>
