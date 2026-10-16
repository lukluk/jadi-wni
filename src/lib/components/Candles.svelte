<script>
	/** @type {{ candles: {o:number,h:number,l:number,c:number}[], entry?: number|null, height?: number, slots?: number }} */
	let { candles, entry = null, height = 90, slots = 0 } = $props();

	const W = 10; // lebar satu slot candle di koordinat viewBox
	const n = $derived(Math.max(slots, candles.length, 1));
	const vals = $derived([...candles.flatMap((c) => [c.h, c.l]), ...(entry != null ? [entry] : [])]);
	const lo = $derived(vals.length ? Math.min(...vals) : 0);
	const hi = $derived(vals.length ? Math.max(...vals) : 1);
	const span = $derived(hi - lo || 1);
	const y = (v) => 4 + (1 - (v - lo) / span) * (height - 8);
</script>

<svg viewBox="0 0 {n * W} {height}" preserveAspectRatio="none" style:height="{height}px" class="candles" aria-hidden="true">
	{#if entry != null}
		<line x1="0" x2={n * W} y1={y(entry)} y2={y(entry)} class="entry" vector-effect="non-scaling-stroke" />
	{/if}
	{#each candles as c, i (i)}
		{@const up = c.c >= c.o}
		{@const x = i * W + W / 2}
		<g class={up ? 'up' : 'down'}>
			<line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} vector-effect="non-scaling-stroke" />
			<rect x={x - W * 0.3} width={W * 0.6} y={Math.min(y(c.o), y(c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} />
		</g>
	{/each}
</svg>

<style>
	.candles {
		width: 100%;
		display: block;
	}
	line {
		stroke: currentColor;
		stroke-width: 1.4;
	}
	rect {
		fill: currentColor;
	}
	.up {
		color: #1f8a4c;
	}
	.down {
		color: var(--merah);
	}
	.entry {
		stroke: var(--ink-soft);
		stroke-dasharray: 3 3;
		stroke-width: 1;
	}
</style>
