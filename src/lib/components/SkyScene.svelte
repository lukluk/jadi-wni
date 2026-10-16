<!-- Pemandangan langit: dipakai di halaman depan & lobby supaya konsisten -->
<div class="scene" aria-hidden="true">
	<div class="sun"></div>
	<div class="clouds">
		<span class="cloud c1"></span>
		<span class="cloud c2"></span>
		<span class="cloud c3"></span>
		<span class="cloud c4"></span>
		<span class="cloud c5"></span>
		<span class="cloud c6"></span>
	</div>
	<div class="birds"><span>︶</span><span>︶</span><span>︶</span></div>
	<svg class="hills" viewBox="0 0 1440 320" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
		<path class="hill-far" d="M0 220 C 180 150 320 170 480 200 C 700 240 820 150 1040 180 C 1240 206 1340 170 1440 190 L1440 320 L0 320 Z" />
		<path class="hill-near" d="M0 260 C 160 210 300 250 460 250 C 680 250 760 210 980 240 C 1180 266 1320 236 1440 250 L1440 320 L0 320 Z" />
	</svg>
	<div class="ground"></div>
</div>

<style>
	.scene {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		background: linear-gradient(
			180deg,
			#2a7bc4 0%,
			#53a3dd 28%,
			#8fcbe8 52%,
			#c7e8f3 70%,
			#eaf7ef 86%,
			#f3fbe9 100%
		);
	}
	.sun {
		position: absolute;
		top: 8%;
		right: 12%;
		width: 150px;
		height: 150px;
		border-radius: 50%;
		background: radial-gradient(circle, #fff6d6 0%, #ffe27a 45%, rgba(255, 222, 92, 0) 72%);
		filter: blur(2px);
		animation: pulse 7s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			transform: scale(1.12);
			opacity: 0.9;
		}
	}
	.clouds {
		position: absolute;
		inset: 0;
	}
	.cloud {
		position: absolute;
		left: 0;
		width: 120px;
		height: 40px;
		background: #fff;
		border-radius: 40px;
		opacity: 0.92;
		box-shadow: 0 10px 24px rgba(40, 90, 140, 0.12);
		animation: drift linear infinite;
	}
	.cloud::before,
	.cloud::after {
		content: '';
		position: absolute;
		background: #fff;
		border-radius: 50%;
	}
	.cloud::before {
		width: 56px;
		height: 56px;
		top: -24px;
		left: 16px;
	}
	.cloud::after {
		width: 78px;
		height: 78px;
		top: -40px;
		left: 48px;
	}
	@keyframes drift {
		from {
			transform: translateX(-20vw) scale(var(--s));
		}
		to {
			transform: translateX(118vw) scale(var(--s));
		}
	}
	.c1 {
		top: 9%;
		--s: 0.6;
		opacity: 0.75;
		animation-duration: 72s;
		animation-delay: -12s;
	}
	.c2 {
		top: 17%;
		--s: 1;
		animation-duration: 56s;
		animation-delay: -30s;
	}
	.c3 {
		top: 27%;
		--s: 0.8;
		opacity: 0.85;
		animation-duration: 88s;
		animation-delay: -6s;
	}
	.c4 {
		top: 41%;
		--s: 1.35;
		animation-duration: 50s;
		animation-delay: -22s;
	}
	.c5 {
		top: 56%;
		--s: 0.5;
		opacity: 0.6;
		animation-duration: 98s;
		animation-delay: -64s;
	}
	.c6 {
		top: 13%;
		--s: 1.1;
		opacity: 0.8;
		animation-duration: 64s;
		animation-delay: -46s;
	}
	.birds {
		position: absolute;
		top: 34%;
		left: 0;
		display: flex;
		gap: 10px;
		color: rgba(20, 33, 61, 0.45);
		font-size: 20px;
		animation: fly 60s linear infinite;
	}
	.birds span:nth-child(2) {
		transform: translateY(-6px) scale(0.8);
	}
	.birds span:nth-child(3) {
		transform: translateY(3px) scale(0.9);
	}
	@keyframes fly {
		from {
			transform: translateX(-10vw) translateY(0);
		}
		50% {
			transform: translateX(55vw) translateY(-20px);
		}
		to {
			transform: translateX(120vw) translateY(10px);
		}
	}
	.hills {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 72px;
		width: 100%;
		height: 42vh;
		min-height: 220px;
	}
	.hill-far {
		fill: #bfe3a6;
	}
	.hill-near {
		fill: #86c56a;
	}
	.ground {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 76px;
		background: linear-gradient(180deg, #6fb457, #5a9e46);
		border-top: 3px solid rgba(20, 33, 61, 0.15);
	}
</style>
