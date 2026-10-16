<script>
	import { untrack } from 'svelte';
	import { TILES, formatRp, formatAmt, netWorth, richestId } from '$lib/shared/board.js';
	import Avatar from './Avatar.svelte';

	/** @type {{ p:any, game:any, isTurn:boolean, isMe:boolean, online:boolean, isHost:boolean, speaking?:boolean, inVoice?:boolean, hold?:boolean, salary?:{id:string, amount:number, n:number}|null }} */
	let { p, game, isTurn, isMe, online, isHost, roomCode = '', onCopyCode, hold = false, salary = null, speaking = false, inVoice = false, stream = null, micMuted = false, camOn = false, canControl = false, onControl } = $props();

	/** pasang MediaStream ke <video> avatar */
	function attach(node, s) {
		node.srcObject = s;
		node.play?.().catch(() => {});
		return {
			update(n) {
				node.srcObject = n;
				node.play?.().catch(() => {});
			},
			destroy: () => (node.srcObject = null)
		};
	}

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

	const king = $derived(richestId(game) === p.id);
	const owned = $derived(Object.values(game.tiles).filter((t) => t.owner === p.id).length);
	const status = $derived(
		p.bankrupt
			? 'Rungkat'
			: p.inJail
				? `Di Ruang Sidang (${p.jailTurns}/3)`
				: game.status === 'lobby'
					? 'Siap main'
					: `Di ${TILES[p.pos].name}`
	);
</script>

<article class="ktp" data-pid={p.id} class:speaking class:turn={isTurn} class:bankrupt={p.bankrupt} style:--c={p.color}>
	<div class="photo" aria-hidden="true">
		{#if stream}
			<video use:attach={stream} autoplay playsinline muted class:mirror={isMe}></video>
		{:else}
			<Avatar {p} />
		{/if}
		{#if isMe && !inVoice}
			<button class="ov bottom join" onclick={() => onControl?.('join')} title="Gabung obrolan suara & video" aria-label="Gabung suara dan video">🎧</button>
		{/if}
		{#if inVoice && canControl}
			<button class="ov top" class:off={micMuted} onclick={() => onControl?.('mic')} title={isMe ? (micMuted ? 'Nyalakan mic' : 'Matikan mic') : 'Matikan mic pemain ini'} aria-label="Mic">{micMuted ? '🔇' : '🎙️'}</button>
			<button class="ov bottom" class:off={!camOn} onclick={() => onControl?.('cam')} title={isMe ? (camOn ? 'Matikan kamera' : 'Nyalakan kamera') : 'Matikan kamera pemain ini'} aria-label="Kamera">📷</button>
		{/if}
		{#if king}<span class="crown" title="Terkaya nomor 1" aria-label="Raja: terkaya nomor 1">👑</span>{/if}
	</div>
	<div class="info">
		<div class="name">
			<span class="online" class:on={online} title={online ? 'Online' : 'Offline'}></span>
			<strong>{p.name}</strong>
			{#if isMe}<span class="tag">kamu</span>{/if}
			{#if p.bot}<span class="tag">🤖 bot</span>{/if}
			{#if isHost}<span class="tag">host</span>{/if}
			{#if isHost && roomCode}<button class="code" onclick={onCopyCode} title="Kode room, klik untuk menyalin link undangan">{roomCode}</button>{/if}
			{#if inVoice}<span class="mic" title="Ikut obrolan suara">{micMuted ? '🔇' : speaking ? '🔊' : '🎙️'}</span>{/if}
			{#if inVoice && isMe}<button class="leave" onclick={() => onControl?.('leave')} title="Keluar dari suara & video" aria-label="Keluar dari suara dan video">Keluar</button>{/if}
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
				<span class="worth" title="Perkiraan total aset: uang + saham + properti + bangunan">≈ {formatRp(netWorth(game, p))}</span>
				<span class="props">{owned} aset{p.jailFree ? ` · ${p.jailFree} Pemutihan` : ''}</span>
			</div>
		{/if}
	</div>
</article>

<style>
	.code {
		font: inherit;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.1em;
		padding: 0.05rem 0.4rem;
		border: 1.5px solid var(--ink);
		border-radius: 999px;
		background: #fff;
		color: var(--ink);
		cursor: pointer;
	}
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
	.leave {
		flex: none;
		padding: 0 0.3rem;
		border: 1.5px solid var(--ink);
		border-radius: 6px;
		background: #fde0dc;
		font-size: 0.62rem;
		font-weight: 800;
		cursor: pointer;
	}
	.ov {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		z-index: 3;
		padding: 0 0.2rem;
		border-radius: 999px;
		background: #fff;
		border: 1.5px solid var(--ink);
		font-size: 0.7rem;
		line-height: 1.3;
		cursor: pointer;
	}
	.ov.off {
		background: #fde0dc;
	}
	.ov.top {
		top: 2px;
	}
	.ov.bottom {
		bottom: 2px;
	}
	.photo video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.photo video.mirror {
		transform: scaleX(-1);
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
		font-size: 1.8rem;
	}
	.crown {
		position: absolute;
		top: -1.05rem;
		left: 50%;
		transform: translateX(-50%) rotate(-8deg);
		font-size: 1.35rem;
		line-height: 1;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.5));
		z-index: 2;
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
	.worth {
		margin-right: auto;
		padding-left: 0.4rem;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--ink-soft);
		white-space: nowrap;
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
