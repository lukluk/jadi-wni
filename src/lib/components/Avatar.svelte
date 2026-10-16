<script>
	/** @type {{ p: { name: string, avatar?: string|null, color: string } }} */
	let { p } = $props();

	let failed = $state(false);
	const initial = $derived((p.name?.trim()[0] ?? '?').toUpperCase());
</script>

{#if p.avatar && !failed}
	<img src={p.avatar} alt="" referrerpolicy="no-referrer" onerror={() => (failed = true)} />
{:else}
	<span class="initial" style:background={p.color}>{initial}</span>
{/if}

<style>
	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: inherit;
		display: block;
	}
	.initial {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		border-radius: inherit;
		color: #fff;
		font-weight: 800;
		font-size: 1em;
		line-height: 1;
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.4);
	}
</style>
