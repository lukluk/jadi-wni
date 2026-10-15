<script>
	let { children } = $props();
</script>

{@render children()}

<style>
	:global(:root) {
		--ktp: #cfe6ec;
		--ktp-deep: #9fcbd6;
		--ink: #14213d;
		--ink-soft: #4a5672;
		--merah: #c8102e;
		--merah-deep: #9b0c23;
		--angkot: #f6c700;
		--paper: #fffdf6;
		--line: rgba(20, 33, 61, 0.18);
		--ok: #2e9e5b;
		--radius-s: 6px;
		--radius-m: 12px;
		color-scheme: light;
	}
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		font-family: 'Bricolage Grotesque', system-ui, sans-serif;
		color: var(--ink);
		background:
			radial-gradient(circle at 20% 0%, rgba(255, 255, 255, 0.55), transparent 50%),
			repeating-linear-gradient(135deg, transparent 0 22px, rgba(20, 33, 61, 0.035) 22px 23px),
			var(--ktp);
		min-height: 100vh;
		font-variant-numeric: tabular-nums;
		-webkit-font-smoothing: antialiased;
	}
	:global(button) {
		font: inherit;
		cursor: pointer;
	}
	:global(button:disabled) {
		cursor: not-allowed;
		opacity: 0.45;
	}
	:global(:focus-visible) {
		outline: 3px solid var(--angkot);
		outline-offset: 2px;
	}
	:global(.btn) {
		border: 2px solid var(--ink);
		background: var(--paper);
		color: var(--ink);
		padding: 0.55rem 1rem;
		border-radius: 999px;
		font-weight: 700;
		box-shadow: 0 3px 0 var(--ink);
		transition: transform 0.08s, box-shadow 0.08s;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
	}
	:global(.btn:not(:disabled):active) {
		transform: translateY(3px);
		box-shadow: 0 0 0 var(--ink);
	}
	:global(.btn.primary) {
		background: var(--merah);
		color: #fff;
	}
	:global(.btn.yellow) {
		background: var(--angkot);
	}
	:global(.btn.small) {
		padding: 0.3rem 0.7rem;
		font-size: 0.85rem;
		box-shadow: 0 2px 0 var(--ink);
	}
	:global(input) {
		font: inherit;
		border: 2px solid var(--ink);
		border-radius: var(--radius-s);
		padding: 0.55rem 0.75rem;
		background: #fff;
		color: var(--ink);
	}
	@media (prefers-reduced-motion: reduce) {
		:global(*) {
			transition: none !important;
			animation: none !important;
		}
	}
</style>
