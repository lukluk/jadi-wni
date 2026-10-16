<script>
	import { untrack } from 'svelte';
	import { TILES, formatRp, formatAmt } from '$lib/shared/board.js';
	import Avatar from './Avatar.svelte';

	/** @type {{ p:any, game:any, isTurn:boolean, isMe:boolean, online:boolean, isHost:boolean, speaking?:boolean, inVoice?:boolean, hold?:boolean, salary?:{id:string, amount:number, n:number}|null }} */
	let { p, game, isTurn, isMe, online, isHost, hold = false, salary = null, speaking = false, inVoice = false } = $props();

	// saldo yang ditampilkan menyusul p.money; kalau turun: blink merah + angka melayang
	// svelte-ignore state_referenced_locally
	let shownMoney = $state(p.money);
	let hurt = $state(false);
	let gain = $state(false);
	let floats = $state(/** @type {{id:number, amt:number, up:boolean}[]} */ ([]));
	let floatId = 0;

	/** ubah saldo tampilan sebesar delta + animasinya */
	function flash(delta) {
		const up = delta > 0;
		const id = ++floatId;
		floats = [...floats, { id, amt: Math.abs(delta), up }];
		hurt = false;
		gain = false;
		requestAnimationFrame(() => (up ? (gain = true) : (hurt = true)));
		setTimeout(() => (floats = floats.filter((f) => f.id !== id)), 1700);
		setTimeout(() => (hurt = gain = false), 1100);
		shownMoney += delta;
	}

	$effect(() => {
		const m = p.money;
		if (hold) return;
		untrack(() => {
			if (m !== shownMoney) flash(m - shownMoney);
		});
	});

	// bidak lewat GAJIAN: gaji masuk saat bidak berhenti di petak GAJIAN
	let lastSalaryN = 0;
	$effect(() => {
		if (!salary || salary.id !== p.id || salary.n === lastSalaryN) return;
		lastSalaryN = salary.n;
		untrack(() => flash(salary.amount));
	});

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

<article class="ktp" data-pid={p.id} class:speaking class:turn={isTurn} class:bankrupt={p.bankrupt} style:--c={p.color}>
	<div class="photo" aria-hidden="true">
		<Avatar {p} />
	</div>
	<div class="info">
		<div class="name">
			<span class="online" class:on={online} title={online ? 'Online' : 'Offline'}></span>
			<strong>{p.name}</strong>
			{#if isMe}<span class="tag">kamu</span>{/if}
			{#if isHost}<span class="tag">host</span>{/if}
			{#if inVoice}<span class="mic" title="Ikut obrolan suara">{speaking ? '🔊' : '🎙️'}</span>{/if}
		</div>
		<div class="status">{status}</div>
		{#if game.status !== 'lobby'}
			<div class="nums">
				<span class="money-wrap">
					<span class="money" class:neg={shownMoney < 0} class:hurt class:gain>{formatRp(shownMoney)}</span>
					{#each floats as f (f.id)}
						<span class={f.up ? 'plus' : 'loss'} aria-hidden="true">{f.up ? '+' : '-'}{formatAmt(f.amt)}</span>
					{/each}
				</span>
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
	.speaking {
		box-shadow: 0 0 0 3px #1f8a4c, 0 0 14px rgba(31, 138, 76, 0.6);
	}
	.mic {
		font-size: 0.8rem;
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
	.money-wrap {
		position: relative;
	}
	.money {
		display: inline-block;
		border-radius: 4px;
	}
	.money.hurt {
		animation: hurt 1.1s ease-out;
	}
	@keyframes hurt {
		0%,
		30%,
		60% {
			background: var(--merah);
			color: #fff;
			transform: translateX(-2px);
		}
		15%,
		45%,
		75% {
			background: transparent;
			color: var(--merah);
			transform: translateX(2px);
		}
		100% {
			background: transparent;
			transform: none;
		}
	}
	.loss {
		position: absolute;
		left: 100%;
		top: 0;
		margin-left: 0.4rem;
		font-weight: 800;
		font-size: 1rem;
		color: var(--merah);
		white-space: nowrap;
		pointer-events: none;
		animation: lossOut 1.6s ease-out forwards;
		z-index: 5;
	}
	.money.gain {
		animation: gain 1.1s ease-out;
	}
	@keyframes gain {
		0%,
		40% {
			background: var(--hijau, #2e9e5b);
			color: #fff;
		}
		100% {
			background: transparent;
		}
	}
	.plus {
		position: absolute;
		left: 100%;
		top: 0;
		margin-left: 0.4rem;
		font-weight: 800;
		font-size: 1rem;
		color: var(--hijau, #2e9e5b);
		white-space: nowrap;
		pointer-events: none;
		animation: plusIn 1.3s ease-out forwards;
		z-index: 5;
	}
	/* masuk dari kanan ke arah saldo, lalu hilang */
	@keyframes plusIn {
		0% {
			opacity: 0;
			transform: translateX(2.4rem);
		}
		30% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateX(-2.2rem);
		}
	}
	@keyframes lossOut {
		from {
			opacity: 1;
			transform: translateX(0);
		}
		to {
			opacity: 0;
			transform: translateX(2.2rem);
		}
	}
	.props {
		font-size: 0.78rem;
		color: var(--ink-soft);
		white-space: nowrap;
	}
</style>
