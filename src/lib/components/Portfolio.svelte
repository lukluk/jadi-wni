<script>
	import Candles from './Candles.svelte';
	import SogokModal from './SogokModal.svelte';
	import { TILES, GROUPS, HOUSE_LEVELS, STOCKS, STOCK_HISTORY, formatRp, candlesOf } from '$lib/shared/board.js';

	/** @type {{ game:any, meId:string, onAction:(a:any)=>void, onTile:(i:number)=>void }} */
	let { game, meId, onAction, onTile } = $props();

	const me = $derived(game.players.find((p) => p.id === meId && !p.bankrupt));
	const playing = $derived(game.status === 'playing');

	const owned = $derived(
		Object.entries(game.tiles)
			.filter(([, t]) => t.owner === meId)
			.map(([i, t]) => ({ tile: TILES[+i], own: t, listed: !!game.market?.[i] }))
			.sort((a, b) => a.tile.i - b.tile.i)
	);

	const books = $derived(
		STOCKS.map((def) => {
			const st = game.stocks?.[def.sym] ?? { price: def.base, prev: def.base, history: [def.base] };
			const h = me?.stocks?.[def.sym] ?? null;
			const value = h ? h.qty * st.price : 0;
			return { def, st, h, value, pl: h ? value - h.cost : 0 };
		})
	);
	const held = $derived(books.filter((b) => b.h));
	const stockTotal = $derived(books.reduce((n, b) => n + b.value, 0));

	let qty = $state({});
	const q = (sym) => Math.max(1, Math.floor(Number(qty[sym] ?? 1)) || 1);

	const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
	const fmtPct = (v) =>
		`${v > 0 ? '▲ +' : v < 0 ? '▼ −' : '■ '}${Math.abs(v).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
	const dir = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');


	let cardPrice = $state(/** @type {string|number|undefined} */ (undefined));

	// judol: taruhan acak -100%..+100%
	let bet = $state(10);
	const betN = $derived(Math.max(0, Math.floor(Number(bet)) || 0));
	const fraction = (f) => (bet = Math.max(1, Math.floor((me?.money ?? 0) * f)));

	// popup daftar saham untuk beli
	let showBuy = $state(false);
	let dialog = $state();
	$effect(() => {
		if (showBuy) dialog?.showModal();
	});
</script>

{#snippet quote(b)}
	{@const tick = pct(b.st.price, b.st.prev)}
	{@const total = pct(b.st.price, b.def.base)}
	<header>
		<div>
			<strong class="sym">{b.def.sym}</strong>
			<span class="nm">{b.def.name}</span>
		</div>
		<div class="px">
			<strong>{formatRp(b.st.price)}<small> /lot</small></strong>
			<span class="chg {dir(tick)}" title="Perubahan sejak giliran sebelumnya">{fmtPct(tick)}</span>
		</div>
	</header>
	<div class="mid">
		<div class="spark"><Candles candles={candlesOf(b.st)} height={44} slots={STOCK_HISTORY - 1} /></div>
		<small class="since {dir(total)}">sejak awal {fmtPct(total)}</small>
	</div>
{/snippet}

<div class="pf">
	{#if !me}
		<p class="empty">Portofolio hanya untuk pemain yang masih aktif.</p>
	{:else}
		<section>
			<h4>Saham</h4>
			<p class="sum saldo">
				<span>Saldo <strong>{formatRp(me.money)}</strong> · Nilai saham <strong>{formatRp(stockTotal)}</strong></span>
				{#if playing}<SogokModal {game} {meId} {onAction} />{/if}
			</p>
			{#if playing}
				<button class="btn primary" onclick={() => (showBuy = true)}>📈 Beli saham</button>
			{/if}

			{#each held as b (b.def.sym)}
				<article class="stock">
					{@render quote(b)}
					<p class="hold">
						Punya <strong>{b.h.qty} lot</strong> · nilai {formatRp(b.value)} ·
						<span class={dir(b.pl)}>{b.pl >= 0 ? 'untung' : 'rugi'} {formatRp(Math.abs(b.pl))} ({fmtPct(pct(b.value, b.h.cost))})</span>
					</p>
					{#if playing}
						<div class="row">
							<input
								type="number"
								min="1"
								inputmode="numeric"
								aria-label={`Jumlah lot ${b.def.sym} yang dijual`}
								value={qty['s' + b.def.sym] ?? 1}
								oninput={(e) => (qty['s' + b.def.sym] = e.currentTarget.value)}
							/>
							<button class="btn small" disabled={b.h.qty < q('s' + b.def.sym)} onclick={() => onAction({ type: 'stockSell', sym: b.def.sym, qty: q('s' + b.def.sym) })}>
								Jual → saldo
							</button>
							{#if b.h.qty > 1}
								<button class="btn small" onclick={() => onAction({ type: 'stockSell', sym: b.def.sym, qty: b.h.qty })}>Jual semua</button>
							{/if}
						</div>
					{/if}
				</article>
			{:else}
				<p class="empty">Belum punya saham. Beli saham memotong saldo; uang kembali ke saldo kalau kamu Jual.</p>
			{/each}
		</section>

		{#if playing}
			<section class="judol">
				<h4>🎰 Judol</h4>
				<p class="note">Taruhan diacak: bisa untung sampai +100% atau rugi sampai −100% dari taruhanmu. Bisa habis semua!</p>
				<div class="row">
					<input
						type="number"
						min="1"
						inputmode="numeric"
						aria-label="Jumlah taruhan (jt)"
						value={bet}
						oninput={(e) => (bet = e.currentTarget.value)}
					/>
					<span class="unit">jt</span>
					<button class="btn small" onclick={() => fraction(0.25)}>¼</button>
					<button class="btn small" onclick={() => fraction(0.5)}>½</button>
					<button class="btn small" onclick={() => fraction(1)}>Semua</button>
				</div>
				<button class="btn danger-btn" disabled={betN < 1 || betN > me.money} onclick={() => onAction({ type: 'judol', amount: betN })}>
					🎲 Taruhan {formatRp(betN)}
				</button>
			</section>
		{/if}

		<section>
			<h4>Aset ({owned.length + (me.jailFree > 0 ? 1 : 0)})</h4>
			{#if me.jailFree > 0}
				{@const listing = game.market?.['card:' + me.id]}
				<div class="card-asset">
					<div class="ca-head">
						<span class="ca-ico">🎫</span>
						<span class="an">Kartu Pemutihan{me.jailFree > 1 ? ` ×${me.jailFree}` : ''}</span>
						<span class="tags">
							{#if listing}<em class="sale">dijual {formatRp(listing.price)}</em>{/if}
						</span>
					</div>
					<small class="note">Bebas dari Ruang Sidang sekali pakai. Bisa dijual di Pasar (satu kartu per listing).</small>
					{#if playing}
						<div class="row">
							<input
								type="number"
								min="1"
								inputmode="numeric"
								aria-label="Harga Kartu Pemutihan (jt)"
								value={cardPrice ?? listing?.price ?? 50}
								oninput={(e) => (cardPrice = e.currentTarget.value)}
							/>
							<span class="unit">jt</span>
							<button
								class="btn small"
								disabled={!(Math.round(Number(cardPrice ?? listing?.price ?? 50)) >= 1)}
								onclick={() => onAction({ type: 'mkList', tile: 'card', price: Math.round(Number(cardPrice ?? listing?.price ?? 50)) })}
							>{listing ? 'Ubah harga' : 'Jual di Pasar'}</button>
							{#if listing}<button class="btn small" onclick={() => onAction({ type: 'mkUnlist', tile: 'card' })}>Tarik</button>{/if}
						</div>
					{/if}
				</div>
			{/if}
			{#each owned as { tile, own, listed } (tile.i)}
				<button class="asset" onclick={() => onTile(tile.i)}>
					{#if tile.group}<i class="band" style:background={GROUPS[tile.group].color}></i>{:else}<i class="band plain"></i>{/if}
					<span class="an">{tile.name}</span>
					<span class="tags">
						{#if own.level}<span title={HOUSE_LEVELS[own.level].name}>{HOUSE_LEVELS[own.level].icon}</span>{/if}
						{#if own.mortgaged}<em>digadai</em>{/if}
						{#if listed}<em class="sale">dijual</em>{/if}
					</span>
					<span class="pr">{formatRp(tile.price)}</span>
				</button>
			{:else}
				<p class="empty">Belum punya aset. Beli properti saat bidakmu mendarat, atau lewat Pasar.</p>
			{/each}
		</section>
	{/if}
</div>

{#if showBuy && me}
	<dialog bind:this={dialog} onclose={() => (showBuy = false)} onclick={(e) => e.target === dialog && dialog.close()}>
		<div class="sheet">
			<h3>📈 Bursa Saham</h3>
			<p class="sum">Saldo <strong>{formatRp(me.money)}</strong> · harga berubah tiap giliran</p>
			{#each books as b (b.def.sym)}
				{@const n = q('b' + b.def.sym)}
				<article class="stock">
					{@render quote(b)}
					<p class="note">{b.def.note}{b.h ? ` · kamu punya ${b.h.qty} lot` : ''}</p>
					<div class="row">
						<input
							type="number"
							min="1"
							inputmode="numeric"
							aria-label={`Jumlah lot ${b.def.sym} yang dibeli`}
							value={qty['b' + b.def.sym] ?? 1}
							oninput={(e) => (qty['b' + b.def.sym] = e.currentTarget.value)}
						/>
						<button class="btn primary small" disabled={me.money < b.st.price * n} onclick={() => onAction({ type: 'stockBuy', sym: b.def.sym, qty: n })}>
							Beli {formatRp(b.st.price * n)}
						</button>
					</div>
				</article>
			{/each}
			<button class="close" onclick={() => dialog.close()} aria-label="Tutup">✕</button>
		</div>
	</dialog>
{/if}


<style>
	.pf {
		display: grid;
		gap: 0.75rem;
	}
	section {
		display: grid;
		gap: 0.45rem;
	}
	h4 {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-soft);
	}
	.saldo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.sum,
	.note,
	.hold,
	.empty {
		margin: 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}
	.hold {
		color: var(--ink);
	}
	.stock {
		border: 2px solid var(--ink);
		border-radius: 10px;
		background: #fff;
		padding: 0.45rem 0.55rem;
		display: grid;
		gap: 0.3rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.sym {
		font-size: 1.05rem;
		letter-spacing: 0.04em;
	}
	.nm {
		display: block;
		font-size: 0.75rem;
		color: var(--ink-soft);
	}
	.px {
		text-align: right;
		display: grid;
	}
	.px small {
		font-weight: 500;
		color: var(--ink-soft);
	}
	.chg {
		font-size: 0.8rem;
		font-weight: 800;
	}
	.up {
		color: #1f8a4c;
	}
	.down {
		color: var(--merah);
	}
	.flat {
		color: var(--ink-soft);
	}
	.mid {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.spark {
		flex: 1;
		min-width: 0;
	}
	.since {
		font-size: 0.72rem;
		font-weight: 700;
		white-space: nowrap;
	}
	.row {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.row input {
		width: 4rem;
		padding: 0.3rem 0.4rem;
	}
	.card-asset {
		border: 2px solid var(--ink);
		border-radius: 8px;
		background: #fff8d6;
		padding: 0.4rem 0.5rem;
		display: grid;
		gap: 0.3rem;
	}
	.ca-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}
	.ca-ico {
		font-size: 1.1rem;
	}
	.unit {
		font-size: 0.8rem;
		color: var(--ink-soft);
	}
	.judol {
		border: 2px dashed var(--ink);
		border-radius: 10px;
		padding: 0.5rem 0.6rem;
		background: #fff3f0;
	}
	.danger-btn {
		background: var(--merah);
		color: #fff;
		border: 2px solid var(--ink);
		border-radius: 8px;
		padding: 0.45rem 0.7rem;
		font-weight: 800;
		cursor: pointer;
	}
	.danger-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.asset {
		all: unset;
		cursor: pointer;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border: 2px solid var(--ink);
		border-radius: 8px;
		background: #fff;
		font-size: 0.85rem;
	}
	.asset:focus-visible {
		outline: 3px solid var(--angkot);
	}
	.asset:hover {
		background: #fff6cf;
	}
	.band {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 2px;
		border: 1px solid var(--ink);
		flex: none;
	}
	.band.plain {
		background: var(--paper);
	}
	.an {
		font-weight: 700;
		flex: 1;
		min-width: 0;
	}
	.tags {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
	}
	.tags em {
		font-style: normal;
		font-size: 0.7rem;
		padding: 0 0.35rem;
		border-radius: 999px;
		background: #e5e1d3;
	}
	.tags em.sale {
		background: var(--angkot);
	}
	.pr {
		color: var(--ink-soft);
		white-space: nowrap;
	}

	dialog {
		border: 0;
		padding: 0;
		background: transparent;
		max-width: min(440px, calc(100vw - 2rem));
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
		padding: 1rem;
		display: grid;
		gap: 0.6rem;
		max-height: calc(100dvh - 3rem);
		overflow-y: auto;
	}
	.sheet h3 {
		margin: 0;
		padding-right: 2rem;
	}
	.close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 2px solid var(--ink);
		background: #fff;
		font-weight: 800;
	}
</style>
