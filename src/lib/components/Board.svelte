<script>
	import { untrack } from 'svelte';
	import { TILES, GROUPS, HOUSE_LEVELS, formatRp, isKing, canBuild, playerTodos } from '$lib/shared/board.js';
	import Avatar from './Avatar.svelte';
	import { play } from '$lib/sound.js';
	import { onMount } from 'svelte';
	import { tilePos, isCorner, makeLayout, cellRect } from '$lib/layout.js';

	/** @type {{ game: any, images?: Record<string, any>, logos?: Record<string, any>, rolling?: boolean, moving?: boolean, onSalary?: (id:string)=>void, onTile: (i:number)=>void, center: import('svelte').Snippet, meId?: string|null }} */
	let { game, images = {}, logos = {}, rolling = false, moving = $bindable(false), shown = $bindable({}), onSalary, onTile, onBuild, center, meId = null } = $props();

	// landscape (layar lebar) -> papan melebar; HP portrait -> persegi
	let landscape = $state(true);
	onMount(() => {
		const mq = matchMedia('(min-width: 901px)');
		const sync = () => (landscape = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
	const L = $derived(makeLayout(landscape));

	const STEP_MS = 190;
	const SALARY_PAUSE_MS = 1500;
	const MAX_WALK = 12;

	/** posisi bidak yang ditampilkan; menyusul p.pos petak demi petak */
	/** bidak berhenti di GAJIAN selama animasi saldo masuk */
	let paused = $state(false);

	$effect(() => {
		moving =
			paused || game.players.some((p) => !p.bankrupt && shown[p.id] !== undefined && shown[p.id] !== p.pos);
	});

	$effect(() => {
		const targets = game.players.map((p) => [p.id, p.pos, p.inJail]);
		if (rolling) return;
		let timer;
		const step = () => {
			let walking = false;
			let gajian = false;
			untrack(() => {
				for (const [id, to, inJail] of targets) {
					const from = shown[id];
					if (from === undefined || from === to) {
						shown[id] = to;
						continue;
					}
					const fwd = (to - from + TILES.length) % TILES.length;
					if (fwd > MAX_WALK || inJail) {
						shown[id] = to; // penjara / kartu lompat: langsung pindah
						continue;
					}
					const next = (from + 1) % TILES.length;
					shown[id] = next;
					walking = true;
					play('step');
					if (next === 0) {
						gajian = true;
						onSalary?.(id);
					}
				}
			});
			if (gajian) {
				paused = true;
				timer = setTimeout(() => {
					paused = false;
					step();
				}, SALARY_PAUSE_MS);
			} else if (walking) timer = setTimeout(step, STEP_MS);
		};
		step();
		return () => {
			clearTimeout(timer);
			paused = false;
		};
	});

	const playerById = $derived(Object.fromEntries(game.players.map((p) => [p.id, p])));

	const CORNER_ICON = { start: '💰', jail: '⚖️', bansos: '🏛️', gotojail: '🚔' };
	const TYPE_ICON = { station: '🚆', utility: '', tax: '🧾', musibah: '⚡', takdir: '🍀' };
	const UTIL_ICON = { PLN: '💡', PDAM: '🚰' };

	/** offset bidak supaya tidak menumpuk */
	function tokenStyle(p, at, idxInTile, countInTile) {
		const { row, col } = tilePos(at, landscape);
		const r = cellRect(L, col, row);
		const spread = countInTile > 1 ? 0.28 * Math.min(r.x1 - r.x0, r.y1 - r.y0) : 0;
		const angle = (idxInTile / countInTile) * Math.PI * 2;
		const x = r.cx + Math.cos(angle) * spread;
		const y = r.cy + (r.y1 - r.y0) * 0.05 + Math.sin(angle) * spread;
		return `left:${x}%;top:${(y / L.H) * 100}%;--c:${p.color}`;
	}

	const tokens = $derived.by(() => {
		const byPos = {};
		const live = game.players.filter((p) => !p.bankrupt);
		const at = (p) => shown[p.id] ?? p.pos;
		for (const p of live) (byPos[at(p)] ??= []).push(p.id);
		return live.map((p) => ({ p, at: at(p), k: byPos[at(p)].indexOf(p.id), n: byPos[at(p)].length }));
	});
	// penanda pemilik: satu avatar mini per (pemilik, grup) di area dalam, dihubungkan garis melengkung ke
	// tiap asetnya — termasuk grup yang menyeberang pojok (petak di dua sisi papan tetap satu penanda).
	// Kalau bertumpuk dengan avatar lain pada sisi yang sama, geser lebih ke tengah.
	const MK = { size: 1.95, gap: 2.4, inner: 1.6, step: 2.4 };
	const pctY = (v) => (v / L.H) * 100;
	const edge = (i) => {
		const { row, col, side } = tilePos(i, landscape);
		const r = cellRect(L, col, row);
		return side === 'b'
			? { side, m: r.cx, inner: [r.cx, r.y0] }
			: side === 't'
				? { side, m: r.cx, inner: [r.cx, r.y1] }
				: side === 'l'
					? { side, m: r.cy, inner: [r.x1, r.cy] }
					: { side, m: r.cy, inner: [r.x0, r.cy] };
	};
	/** titik avatar pada sumbu m di jalur `lane` (0 = tepat di sisi dalam petak, makin besar makin ke tengah) */
	const slot = (side, m, lane) => {
		const d = MK.inner + lane * MK.step;
		return side === 'b' ? [m, L.Y[L.rows - 1] - d] : side === 't' ? [m, L.Y[1] + d] : side === 'l' ? [L.X[1] + d, m] : [L.X[L.cols - 1] - d, m];
	};
	/** garis melengkung (busur) dari (x0,y0) ke (x1,y1); `dir` = sisi lengkungan (+1 / -1) */
	function arc([x0, y0], [x1, y1], dir = 1) {
		const len = Math.hypot(x1 - x0, y1 - y0) || 1;
		const bow = dir * Math.max(3, len * 0.32);
		const cx = (x0 + x1) / 2 - ((y1 - y0) / len) * bow;
		const cy = (y0 + y1) / 2 + ((x1 - x0) / len) * bow;
		return `M${x0.toFixed(2)} ${y0.toFixed(2)} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
	}
	const markers = $derived.by(() => {
		const groups = new Map();
		for (const [k, own] of Object.entries(game.tiles)) {
			const owner = playerById[own.owner];
			// penanda kepemilikan semua pemain ditampilkan (avatar mini berwarna + garis ke tiap asetnya)
			if (!owner || owner.bankrupt) continue;
			const t = TILES[+k];
			const e = edge(+k);
			// satu grup warna milik pemain / group yang sama = satu penanda (menyeberang pojok pun tetap satu).
			// Anggota se-group (teamId sama) berbagi satu penanda → avatar mini bisa 2.
			const teamKey = owner.teamId ?? owner.id;
			const key = `${teamKey}|${t.group ?? t.type}`;
			const g = groups.get(key) ?? { owner, key, owners: [], ownerIds: new Set(), tiles: [] };
			if (!g.ownerIds.has(owner.id)) {
				g.ownerIds.add(owner.id);
				g.owners.push(owner);
			}
			g.tiles.push({ i: +k, owner, ...e, mortgaged: !!own.mortgaged });
			groups.set(key, g);
		}
		const all = [...groups.values()].map((g) => {
			const sides = new Set(g.tiles.map((t) => t.side));
			return {
				...g,
				single: sides.size === 1 ? g.tiles[0].side : null, // null = menyeberang pojok
				m: g.tiles.reduce((n, t) => n + t.m, 0) / g.tiles.length
			};
		});
		// susun jalur anti-tumpuk hanya untuk grup yang semua petaknya di satu sisi
		for (const side of ['b', 'l', 't', 'r']) {
			const lastOf = [];
			for (const g of all.filter((g) => g.single === side).sort((a, b) => a.m - b.m)) {
				let lane = 0;
				while (lastOf[lane] !== undefined && g.m - lastOf[lane] < MK.gap) lane++;
				lastOf[lane] = g.m;
				g.lane = lane;
			}
		}
		const cX = 50;
		const cY = L.H / 2;
		return all.map((g) => {
			let at;
			if (g.single) {
				at = slot(g.single, g.m, g.lane ?? 0);
			} else {
				// grup menyeberang pojok: avatar di titik-tengah aset, digeser ke arah pusat papan
				const bx = g.tiles.reduce((n, t) => n + t.inner[0], 0) / g.tiles.length;
				const by = g.tiles.reduce((n, t) => n + t.inner[1], 0) / g.tiles.length;
				const dx = cX - bx;
				const dy = cY - by;
				const len = Math.hypot(dx, dy) || 1;
				const push = MK.inner + MK.step;
				at = [bx + (dx / len) * push, by + (dy / len) * push];
			}
			return {
				...g,
				x: at[0],
				y: at[1],
				paths: g.tiles.map((t) => ({ i: t.i, mortgaged: t.mortgaged, color: t.owner.color, d: arc(at, t.inner, t.m >= g.m ? 1 : -1), end: t.inner }))
			};
		});
	});
	const kingOf = $derived((id) => isKing(game, id));
	const currentId = $derived(game.status === 'playing' ? game.players[game.turn]?.id : null);
	// catatan tempel (sticky note) rekomendasi untuk pemain ini; kosong = tidak ditampilkan
	const todos = $derived(game.status === 'playing' ? playerTodos(game, meId) : []);
</script>

<div class="arena">
<div
	class="board"
	role="group"
	aria-label="Papan permainan"
	style:grid-template-columns="repeat({L.cols}, 1fr)"
	style:grid-template-rows="repeat({L.rows}, 1fr)"
	style:aspect-ratio={L.ratio}
>
	{#each TILES as t (t.i)}
		{@const pos = tilePos(t.i, landscape)}
		{@const own = game.tiles[t.i]}
		<button
			class="tile side-{pos.side} type-{t.type}"
			class:corner={isCorner(t.i)}
			class:mortgaged={own?.mortgaged}
			class:pending={game.pendingBuy === t.i && !moving && !rolling}
			style:grid-row={pos.row + 1}
			style:grid-column={pos.col + 1}
			onclick={() => onTile(t.i)}
			aria-label={t.name}
		>
			{#if t.group}<span class="band" style:background={GROUPS[t.group].color}></span>{/if}
			<span class="body" class:photo={!!images[t.name]} style:--img={images[t.name] ? `url("${images[t.name].url}")` : null}>
				{#if logos[t.name]}
					<img class="logo" src={logos[t.name].url} alt="" title={`Logo ${t.name} · ${logos[t.name].credit}${logos[t.name].license ? `, ${logos[t.name].license}` : ''}`} referrerpolicy="no-referrer" />
				{:else if isCorner(t.i)}
					<span class="cicon">{CORNER_ICON[t.type]}</span>
				{:else if TYPE_ICON[t.type] || UTIL_ICON[t.name]}
					<span class="ticon">{TYPE_ICON[t.type] || UTIL_ICON[t.name]}</span>
				{/if}
				<span class="name">{t.short ?? t.name}</span>
				{#if t.price && !own}<span class="price">{t.price}jt</span>{/if}
				{#if t.type === 'tax'}<span class="price">-{t.amount}jt</span>{/if}
			</span>
		</button>
	{/each}

	<div class="center" style:grid-row="2 / {L.rows}" style:grid-column="2 / {L.cols}">
		{#if todos.length}
			<aside class="todo-note" aria-label="Rekomendasi untukmu">
				<strong class="tn-title">📝 Saran buatmu</strong>
				<ul>
					{#each todos as it (it.key)}
						<li class:done={it.done}>{it.text}</li>
					{/each}
				</ul>
			</aside>
		{/if}
		{@render center()}
	</div>

	<!-- ikon rumah: di luar petak, menjorok ke area tengah (biru muda) -->
	{#each TILES as t (t.i)}
		{@const own = game.tiles[t.i]}
		{@const bq = canBuild(game, meId, t.i)}
		{#if t.group && (own?.level || bq)}
			{@const hp = edge(t.i)}
			{@const hx = hp.inner[0] + (hp.side === 'l' ? 1 : hp.side === 'r' ? -1 : 0) * 1.6}
			{@const hy = hp.inner[1] + (hp.side === 't' ? 1 : hp.side === 'b' ? -1 : 0) * 1.6}
			{#if own?.level}
				<span
					class="house"
					title={`${t.name}: ${HOUSE_LEVELS[own.level].name}`}
					style:left="{hx}%"
					style:top="{pctY(hy)}%"
					style:--g={GROUPS[t.group].color}
				>{HOUSE_LEVELS[own.level].icon}</span>
			{/if}
			{#if bq}
				<button
					class="upgrade"
					class:attached={!!own?.level}
					class:poor={!bq.afford}
					title={`${t.name}: bangun ${bq.name} (${formatRp(bq.cost)})${bq.afford ? '' : ' — uang belum cukup'}`}
					aria-label={`Bangun ${bq.name} di ${t.name} seharga ${formatRp(bq.cost)}`}
					style:left="{hx}%"
					style:top="{pctY(hy)}%"
					style:--g={GROUPS[t.group].color}
					onclick={(e) => { e.stopPropagation(); onBuild?.(t.i); }}
				>+</button>
			{/if}
		{/if}
	{/each}

	{#each tokens as { p, at, k, n } (p.id)}
		<span class="token" class:active={p.id === currentId} class:hop={at !== p.pos} style={tokenStyle(p, at, k, n)} title={p.name}>
			<Avatar {p} />
		</span>
		{#if kingOf(p.id)}<span class="crown" class:hop={at !== p.pos} style={tokenStyle(p, at, k, n)} aria-hidden="true">👑</span>{/if}
	{/each}
</div>

	<!-- penanda pemilik: avatar mini + garis melengkung ke tiap aset -->
	<svg class="mlines" viewBox="0 0 100 {L.H}" aria-hidden="true">
		{#each markers as g (g.key)}
			{#each g.paths as t (t.i)}
				<path d={t.d} class="under" vector-effect="non-scaling-stroke" />
				<path d={t.d} style:stroke={t.color} stroke-dasharray={t.mortgaged ? '3 2' : null} vector-effect="non-scaling-stroke" />
				<circle cx={t.end[0]} cy={t.end[1]} r="0.6" style:fill={t.color} class="dot" />
			{/each}
		{/each}
	</svg>
	{#each markers as g (g.key)}
		<span
			class="mava"
			class:team={g.owners.length > 1}
			style:left="{g.x}%"
			style:top="{pctY(g.y)}%"
			style:--c={g.owners[0].color}
			title={`Milik ${g.owners.map((o) => o.name).join(' & ')}${g.owners.length > 1 ? ' (1 group)' : ''}${g.tiles.length > 1 ? ` · ${g.tiles.length} aset` : ''}`}
		>
			{#each g.owners as o (o.id)}
				<span class="mava-face" style:--c={o.color}><Avatar p={o} /></span>
			{/each}
		</span>
	{/each}
</div>

<style>
	.arena {
		position: relative;
		width: 100%;
		box-sizing: border-box;
		container-type: inline-size;
	}
	.mlines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
		z-index: 3;
	}
	.mlines path {
		fill: none;
		stroke-width: 1.8px;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.mlines path.under {
		stroke: #fff;
		stroke-width: 4px;
	}
	.mlines .dot {
		stroke: #fff;
		stroke-width: 0.5px;
	}
	.mava {
		position: absolute;
		transform: translate(-50%, -50%);
		z-index: 4;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.mava-face {
		width: 1.95cqi;
		height: 1.95cqi;
		border-radius: 50%;
		overflow: hidden;
		border: max(1px, 0.2cqi) solid var(--c);
		background: #fff;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
		font-size: 1cqi;
		box-sizing: border-box;
		flex: none;
	}
	/* anggota se-group: dua avatar mini saling tumpuk sedikit */
	.mava.team .mava-face:not(:first-child) {
		margin-left: -0.5cqi;
	}
	.board {
		position: relative;
		display: grid;
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
	.house {
		position: absolute;
		transform: translate(-50%, -50%);
		pointer-events: none;
		font-size: clamp(9px, 3.1cqi, 22px);
		line-height: 1;
		padding: 2px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.85);
		border: 2px solid var(--g);
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.35));
		z-index: 1;
	}
	.upgrade {
		position: absolute;
		transform: translate(-50%, -50%);
		z-index: 3;
		display: grid;
		place-items: center;
		width: clamp(14px, 3.4cqi, 24px);
		height: clamp(14px, 3.4cqi, 24px);
		padding: 0;
		border-radius: 50%;
		border: 2px solid #fff;
		background: var(--g, #2e9e5b);
		color: #fff;
		font-size: clamp(11px, 3cqi, 20px);
		font-weight: 900;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
		animation: upgrade-pop 1.6s ease-in-out infinite;
	}
	/* kalau sudah ada rumah, tempel sebagai badge di pojok kanan-atas ikon rumah */
	.upgrade.attached {
		transform: translate(35%, -115%);
	}
	.upgrade.poor {
		background: var(--ink-soft, #7a7a7a);
		opacity: 0.85;
		animation: none;
	}
	.upgrade:hover {
		filter: brightness(1.08);
	}
	.upgrade:active {
		transform: translate(-50%, -50%) scale(0.9);
	}
	.upgrade.attached:active {
		transform: translate(35%, -115%) scale(0.9);
	}
	@keyframes upgrade-pop {
		0%, 100% { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45), 0 0 0 0 rgba(46, 158, 91, 0); }
		50% { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45), 0 0 0 4px rgba(46, 158, 91, 0.25); }
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
		background: var(--img) center / cover no-repeat;
	}
	.body.photo .name,
	.body.photo .price {
		background: rgba(255, 253, 246, 0.92);
		border-radius: 3px;
		padding: 0 3px;
	}
	.body.photo .price {
		color: var(--ink);
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
	.logo {
		max-width: 82%;
		max-height: 42%;
		object-fit: contain;
		flex: 0 1 auto;
		min-height: 0;
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
		position: relative;
		background:
			radial-gradient(circle at 50% 40%, #e8f5f8, var(--ktp) 70%);
		display: grid;
		place-items: center;
		padding: 3%;
		min-height: 0;
		overflow: auto;
	}
	/* catatan tempel rekomendasi: menempel di pojok kanan-atas kotak biru */
	.todo-note {
		position: absolute;
		top: 2.5%;
		right: 2.5%;
		/* di bawah rumah (1), garis kepemilikan (3) & avatar mini (4) — note cuma di latar kotak biru */
		z-index: 0;
		width: clamp(96px, 23cqi, 190px);
		padding: clamp(0.3rem, 1.4cqi, 0.6rem) clamp(0.35rem, 1.5cqi, 0.65rem);
		background: linear-gradient(180deg, #fff7a8, #ffee82);
		border: 1px solid rgba(20, 33, 61, 0.14);
		box-shadow: 2px 3px 7px rgba(20, 33, 61, 0.28);
		transform: rotate(2.4deg);
		font-size: clamp(0.5rem, 1.55cqi, 0.78rem);
		line-height: 1.28;
		color: #4a4320;
		text-align: left;
	}
	.todo-note::before {
		/* selotip di atas sticky note */
		content: '';
		position: absolute;
		top: -0.5rem;
		left: 50%;
		transform: translateX(-50%) rotate(-3deg);
		width: 46%;
		height: 0.85rem;
		background: rgba(255, 255, 255, 0.5);
		border: 1px solid rgba(20, 33, 61, 0.08);
	}
	.tn-title {
		display: block;
		font-weight: 800;
		margin-bottom: 0.25em;
		color: #7a6a16;
	}
	.todo-note ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.22em;
	}
	.todo-note li {
		position: relative;
		padding-left: 1.05em;
	}
	.todo-note li::before {
		content: '☐';
		position: absolute;
		left: 0;
	}
	.todo-note li.done {
		color: rgba(74, 67, 32, 0.55);
		text-decoration: line-through;
	}
	.todo-note li.done::before {
		content: '☑';
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
		overflow: hidden;
		font-size: clamp(9px, 2.9cqi, 22px);
		line-height: 1;
		box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
		transition:
			left 0.18s ease-in-out,
			top 0.18s ease-in-out;
		pointer-events: none;
		z-index: 3;
	}
	.crown {
		position: absolute;
		transform: translate(-50%, -135%) rotate(-8deg);
		font-size: clamp(9px, 2.8cqi, 20px);
		line-height: 1;
		pointer-events: none;
		z-index: 5;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.5));
		transition:
			left 0.18s ease-in-out,
			top 0.18s ease-in-out;
	}
	.token.hop {
		animation: hop 0.19s ease-out;
	}
	@keyframes hop {
		50% {
			margin-top: -1.2cqi;
		}
	}
	.token.active {
		box-shadow:
			0 0 0 3px var(--angkot),
			0 2px 0 rgba(0, 0, 0, 0.35);
		z-index: 4;
	}
</style>
