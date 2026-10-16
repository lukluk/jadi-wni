<script>
	import { TILES, GROUPS, formatRp, SOGOK_MIN_MONEY, SOGOK_RISK, sogokPrice, sogokFee } from '$lib/shared/board.js';

	/** @type {{ game:any, meId:string, onAction:(a:any)=>void }} */
	let { game, meId, onAction } = $props();

	const me = $derived(game.players.find((p) => p.id === meId && !p.bankrupt));

	// sogok aparat: paksa pemilik jual aset (butuh saldo >= 2 M, sekali per giliran)
	const sogokOpen = $derived(!!me && me.money >= SOGOK_MIN_MONEY);
	const myTurn = $derived(game.players[game.turn]?.id === meId);
	const sogokReady = $derived(
		sogokOpen && myTurn && (game.phase === 'roll' || game.phase === 'end') && !me?.inJail && me?.sogokTurn !== game.turnCount
	);
	const targets = $derived(
		Object.entries(game.tiles)
			.filter(([, t]) => t.owner !== meId && !game.players.find((p) => p.id === t.owner)?.bankrupt)
			.map(([i, t]) => {
				const price = sogokPrice(game, +i);
				return { tile: TILES[+i], own: t, price, fee: sogokFee(price), owner: game.players.find((p) => p.id === t.owner) };
			})
			.sort((a, b) => a.tile.i - b.tile.i)
	);

	let open = $state(false);
	let dialog = $state();
	$effect(() => {
		if (open) dialog?.showModal();
	});
</script>

<button
	class="sogok-btn"
	class:locked={!sogokOpen}
	onclick={() => (open = true)}
	title={sogokOpen ? 'Sogok Aparat' : `Sogok Aparat (terkunci, butuh ${formatRp(SOGOK_MIN_MONEY)})`}
	aria-label="Sogok Aparat"
>
	🕴️
</button>

{#if open && me}
	<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && dialog.close()}>
		<div class="sheet">
			<h3>🕴️ Sogok Aparat</h3>
			<p class="note">
				Saldo ≥ {formatRp(SOGOK_MIN_MONEY)} → paksa pemilik jual asetnya di harga asli (petak + bangunan) ditambah uang sogok {formatRp(sogokFee())} ke Kas Negara.
				Risiko {Math.round(SOGOK_RISK * 100)}% ketahuan KPK: sogok hangus &amp; masuk Ruang Sidang. Sekali per giliran, saat gilirmu.
			</p>
			{#if !sogokOpen}
				<p class="note"><b>🔒 Terkunci</b> — saldomu {formatRp(me.money)}, butuh {formatRp(SOGOK_MIN_MONEY)}.</p>
			{/if}
			{#each targets as t (t.tile.i)}
				<div class="target">
					<span class="tn">
						{#if t.tile.group}<i class="band" style:background={GROUPS[t.tile.group].color}></i>{/if}
						{t.tile.name} <small>· {t.owner?.name}</small>
					</span>
					<button
						class="btn small danger-btn"
						disabled={!sogokReady || me.money < t.price + t.fee}
						onclick={() => {
							onAction({ type: 'sogokPaksa', tile: t.tile.i });
							dialog.close();
						}}
					>
						{formatRp(t.price + t.fee)}
					</button>
				</div>
			{:else}
				<p class="empty">Belum ada aset milik pemain lain.</p>
			{/each}
			<button class="close" onclick={() => dialog.close()} aria-label="Tutup">✕</button>
		</div>
	</dialog>
{/if}

<style>
	.sogok-btn {
		flex: none;
		width: 1.9rem;
		height: 1.9rem;
		padding: 0;
		border: 2px solid var(--ink);
		border-radius: 50%;
		background: #f3f0ff;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	.sogok-btn.locked {
		opacity: 0.5;
		filter: grayscale(1);
	}
	.target {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		padding: 0.2rem 0;
		font-size: 0.85rem;
	}
	.target .band {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 2px;
		margin-right: 0.25rem;
	}
	.note,
	.empty {
		margin: 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}
	.danger-btn {
		background: var(--merah);
		color: #fff;
		border: 2px solid var(--ink);
		border-radius: 8px;
		font-weight: 800;
		cursor: pointer;
	}
	.danger-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		border: 2px solid var(--ink);
		border-radius: 50%;
		background: #fff;
		cursor: pointer;
	}
</style>
