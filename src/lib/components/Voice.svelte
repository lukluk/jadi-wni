<script>
	import { onMount } from 'svelte';
	import { getSocket } from '$lib/socket.js';
	import { isMuted, setMuted, play } from '$lib/sound.js';

	/** @type {{ meId: string, canVoice?: boolean, players?: {id:string, name:string, color:string}[], speaking?: Record<string, boolean>, members?: string[] }} */
	let { meId, canVoice = true, players = [], speaking = $bindable({}), members = $bindable([]), streams = $bindable({}), states = $bindable({}), isHost = false } = $props();

	// STUN publik; kalau ada pemain di jaringan ketat (NAT simetris) butuh server TURN sendiri
	const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
	const SPEAK_LEVEL = 0.035;

	// pengaturan (ikon melayang -> modal): efek suara game + obrolan suara/mic/kamera
	let open = $state(false);
	let dialog = $state();
	let sfxMuted = $state(isMuted());
	$effect(() => {
		if (open) dialog?.showModal();
	});
	function toggleSfx() {
		sfxMuted = !sfxMuted;
		setMuted(sfxMuted);
		if (!sfxMuted) play('notif');
	}

	let joined = $state(false);
	let muted = $state(false);
	let noMic = $state(false);
	let busy = $state(false);
	let error = $state('');
	let camOn = $state(false);
	/** @type {MediaStream|null} */
	let selfCam = $state(null);
	/** @type {{sid:string, userId:string, stream:MediaStream, hasVideo:boolean}[]} */
	let peers = $state([]);

	// undangan voice: muncul saat pemain lain mulai voice chat & aku belum ikut
	let invite = $state(/** @type {{id:string, name:string}|null} */ (null));
	const inviteDismissed = new Set();
	let seenMembers = new Set();

	/** @type {Map<string, RTCPeerConnection>} */
	const pcs = new Map();
	/** negosiasi "perfect negotiation": making = sedang membuat offer, ignore = abaikan offer tabrakan */
	const neg = new Map();
	/** @type {Map<string, RTCIceCandidateInit[]>} */
	const pendingIce = new Map();
	/** @type {Map<string, {userId:string, analyser:AnalyserNode, buf:Uint8Array}>} */
	const meters = new Map();
	/** @type {MediaStream|null} */
	let local = null;
	/** @type {AudioContext|null} */
	let ctx = null;
	let meterTimer;

	const sock = () => getSocket();

	// stream video per pemain (untuk avatar) + status mic/kamera semua anggota
	$effect(() => {
		const out = {};
		for (const p of peers) if (p.hasVideo) out[p.userId] = p.stream;
		if (selfCam) out[meId] = selfCam;
		streams = out;
	});
	// kabari room soal status mic/kamera kita
	$effect(() => {
		if (joined) sock().emit('voice:state', { muted: muted || noMic, cam: camOn });
	});
	// undangan: kalau pemain lain mulai voice chat & aku belum gabung, tawari untuk gabung
	$effect(() => {
		const cur = members ?? [];
		if (joined || busy || !canVoice) {
			invite = null;
			seenMembers = new Set(cur);
			return;
		}
		if (invite && !cur.includes(invite.id)) invite = null; // pengundang keburu keluar
		if (!invite) {
			for (const id of cur) {
				if (id === meId || seenMembers.has(id) || inviteDismissed.has(id)) continue;
				invite = { id, name: players.find((p) => p.id === id)?.name ?? 'Seseorang' };
				play('notif');
				break;
			}
		}
		seenMembers = new Set(cur);
	});
	function acceptInvite() {
		invite = null;
		if (!joined) join();
	}
	function dismissInvite() {
		if (invite) inviteDismissed.add(invite.id);
		invite = null;
	}

	/** kontrol dari kartu pemain: diri sendiri langsung, pemain lain lewat host */
	export function control(userId, kind) {
		if (userId === meId && kind === 'leave') return cleanup(true);
		if (userId === meId && kind === 'join') return joined ? undefined : join();
		if (userId === meId) return kind === 'mic' ? toggleMute() : toggleCamera();
		if (isHost) sock().emit('voice:control', { userId, kind });
	}
	export const isJoined = () => joined;

	function addMeter(key, userId, stream) {
		try {
			ctx ??= new AudioContext();
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			ctx.createMediaStreamSource(stream).connect(analyser);
			meters.set(key, { userId, analyser, buf: new Uint8Array(analyser.fftSize) });
		} catch {
			/* tanpa indikator bicara */
		}
	}

	function sampleMeters() {
		const now = {};
		for (const [key, m] of meters) {
			m.analyser.getByteTimeDomainData(m.buf);
			let sum = 0;
			for (const v of m.buf) sum += ((v - 128) / 128) ** 2;
			const loud = Math.sqrt(sum / m.buf.length) > SPEAK_LEVEL && !(key === 'me' && muted);
			if (loud) now[m.userId] = true;
		}
		const same =
			Object.keys(now).length === Object.keys(speaking).length && Object.keys(now).every((k) => speaking[k]);
		if (!same) speaking = now;
	}

	function liveVideo(stream) {
		return stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
	}

	function refreshVideo(sid) {
		const p = peers.find((x) => x.sid === sid);
		if (p) p.hasVideo = liveVideo(p.stream);
	}

	function watchTrack(sid, track) {
		track.onmute = track.onunmute = track.onended = () => refreshVideo(sid);
		refreshVideo(sid);
	}

	function makePeer(sid, userId) {
		const pc = new RTCPeerConnection(ICE);
		pcs.set(sid, pc);
		neg.set(sid, { making: false, ignore: false });
		for (const t of local?.getTracks() ?? []) pc.addTrack(t, /** @type {MediaStream} */ (local));
		// tanpa mikrofon: tetap bisa dengar (dan memicu negosiasi)
		if (!local?.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
		pc.onicecandidate = (e) => e.candidate && sock().emit('voice:signal', { to: sid, data: { candidate: e.candidate } });
		pc.ontrack = (e) => {
			const stream = e.streams[0];
			if (!stream) return;
			if (!peers.some((p) => p.sid === sid)) {
				peers = [...peers, { sid, userId, stream, hasVideo: false }];
				addMeter(sid, userId, stream);
				stream.onremovetrack = () => refreshVideo(sid);
			}
			watchTrack(sid, e.track);
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed') dropPeer(sid);
		};
		pc.onnegotiationneeded = async () => {
			const st = neg.get(sid);
			try {
				if (st) st.making = true;
				await pc.setLocalDescription();
				sock().emit('voice:signal', { to: sid, data: { description: pc.localDescription } });
			} catch (e) {
				console.error(e);
			} finally {
				if (st) st.making = false;
			}
		};
		return pc;
	}

	function dropPeer(sid) {
		pcs.get(sid)?.close();
		pcs.delete(sid);
		pendingIce.delete(sid);
		neg.delete(sid);
		meters.delete(sid);
		peers = peers.filter((p) => p.sid !== sid);
	}

	async function onSignal({ from, userId, data }) {
		if (!joined) return;
		const pc = pcs.get(from) ?? makePeer(from, userId);
		const st = neg.get(from) ?? { making: false, ignore: false };
		const polite = (sock().id ?? '') > from;
		try {
			if (data.description) {
				const d = data.description;
				const collision = d.type === 'offer' && (st.making || pc.signalingState !== 'stable');
				st.ignore = !polite && collision;
				if (st.ignore) return;
				await pc.setRemoteDescription(d);
				for (const c of pendingIce.get(from) ?? []) await pc.addIceCandidate(c);
				pendingIce.delete(from);
				if (d.type === 'offer') {
					await pc.setLocalDescription();
					sock().emit('voice:signal', { to: from, data: { description: pc.localDescription } });
				}
			} else if (data.candidate) {
				if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch((e) => !st.ignore && console.error(e));
				else pendingIce.set(from, [...(pendingIce.get(from) ?? []), data.candidate]);
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function join() {
		error = '';
		busy = true;
		try {
			if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser tidak mendukung mikrofon (butuh HTTPS atau localhost).');
			try {
				local = await navigator.mediaDevices.getUserMedia({
					audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
				});
			} catch (e) {
				if (e?.name !== 'NotFoundError' && e?.name !== 'OverconstrainedError') throw e;
				// tidak ada mikrofon: masuk sebagai pendengar
				local = new MediaStream();
				noMic = true;
			}
			const res = await new Promise((resolve) =>
				sock()
					.timeout(8000)
					.emit('voice:join', null, (err, r) => resolve(err ? { ok: false, error: 'Server tidak merespons.' } : r))
			);
			if (!res.ok) throw new Error(res.error);
			joined = true;
			muted = noMic;
			if (!noMic) addMeter('me', meId, local);
			clearInterval(meterTimer);
			meterTimer = setInterval(sampleMeters, 150);
			for (const p of res.peers) makePeer(p.sid, p.userId);
		} catch (e) {
			error = e?.name === 'NotAllowedError' ? 'Izin mikrofon ditolak.' : (e?.message ?? 'Gagal masuk voice.');
			cleanup(false);
		}
		busy = false;
	}

	function cleanup(notify = true) {
		if (notify && joined) sock().emit('voice:leave');
		joined = false;
		noMic = false;
		clearInterval(meterTimer);
		for (const sid of [...pcs.keys()]) dropPeer(sid);
		meters.clear();
		local?.getTracks().forEach((t) => t.stop());
		local = null;
		selfCam = null;
		camOn = false;
		ctx?.close().catch(() => {});
		ctx = null;
		speaking = {};
	}

	function toggleMute() {
		if (noMic) {
			error = 'Mikrofon tidak ditemukan — kamu masuk sebagai pendengar.';
			return;
		}
		muted = !muted;
		for (const t of local?.getAudioTracks() ?? []) t.enabled = !muted;
	}

	async function toggleCamera() {
		if (!local) return;
		error = '';
		if (camOn) {
			for (const t of local.getVideoTracks()) {
				for (const pc of pcs.values()) {
					const sender = pc.getSenders().find((x) => x.track === t);
					if (sender) pc.removeTrack(sender);
				}
				local.removeTrack(t);
				t.stop();
			}
			selfCam = null;
			camOn = false;
			return;
		}
		try {
			const cam = await navigator.mediaDevices.getUserMedia({
				video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' }
			});
			const track = cam.getVideoTracks()[0];
			local.addTrack(track);
			for (const pc of pcs.values()) pc.addTrack(track, local);
			selfCam = new MediaStream([track]);
			camOn = true;
			track.onended = () => camOn && toggleCamera();
		} catch (e) {
			error = e?.name === 'NotAllowedError' ? 'Izin kamera ditolak.' : 'Kamera tidak tersedia.';
		}
	}

	/** pasang stream ke elemen audio/video */
	function attach(node, stream) {
		node.srcObject = stream;
		node.play?.().catch(() => {});
		return { destroy: () => (node.srcObject = null) };
	}

	onMount(() => {
		const s = sock();
		const onMembers = (list) => (members = list);
		const onLeft = ({ sid }) => dropPeer(sid);
		const onStates = (m) => (states = m);
		const onControl = ({ kind }) => {
			if (kind === 'mic' && joined && !muted && !noMic) toggleMute();
			else if (kind === 'cam' && camOn) toggleCamera();
		};
		const onDisconnect = () => cleanup(false);
		s.on('voice:states', onStates);
		s.on('voice:control', onControl);
		s.on('voice:signal', onSignal);
		s.on('voice:peer-left', onLeft);
		s.on('voice:members', onMembers);
		s.on('disconnect', onDisconnect);
		s.emit('voice:query', null, (r) => {
			if (r?.members) members = r.members;
			if (r?.states) states = r.states;
		});
		return () => {
			s.off('voice:signal', onSignal);
			s.off('voice:peer-left', onLeft);
			s.off('voice:members', onMembers);
			s.off('voice:states', onStates);
			s.off('voice:control', onControl);
			s.off('disconnect', onDisconnect);
			cleanup(true);
		};
	});
</script>

<button class="gear" onclick={() => (open = true)} aria-label="Pengaturan" title="Pengaturan">
	⚙️
</button>

{#if open}
	<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && dialog.close()}>
		<div class="sheet">
			<h3>⚙️ Pengaturan</h3>

			<div class="row">
				<span class="lbl">🔊 Efek suara game</span>
				<button class="sw" class:on={!sfxMuted} onclick={toggleSfx} role="switch" aria-checked={!sfxMuted}>{sfxMuted ? 'Mati' : 'Nyala'}</button>
			</div>

			<button class="close" onclick={() => dialog.close()} aria-label="Tutup">✕</button>
		</div>
	</dialog>
{/if}

{#if error}
	<button class="verr toast" onclick={() => (error = '')}>{error}</button>
{/if}

{#if invite && !joined}
	<div class="vinvite" role="alertdialog" aria-live="polite">
		<span class="vinvite-txt">🎙️ <strong>{invite.name}</strong> mengajak voice chat</span>
		<div class="vinvite-acts">
			<button class="btn small primary" disabled={busy} onclick={acceptInvite}>Gabung</button>
			<button class="btn small" onclick={dismissInvite}>Abaikan</button>
		</div>
	</div>
{/if}

<!-- elemen pemutar audio peer (disembunyikan); video tampil di avatar PlayerCard -->
<div class="faces">
	{#each peers as p (p.sid)}
		<video use:attach={p.stream} autoplay playsinline></video>
	{/each}
</div>

<style>
	/* ikon pengaturan: ujung kanan bar ticker di paling bawah */
	.gear {
		position: fixed;
		right: 0.35rem;
		bottom: 0.2rem;
		z-index: 71;
		width: 1.8rem;
		height: 1.8rem;
		padding: 0;
		border-radius: 50%;
		border: 2px solid var(--ink);
		background: #fff;
		box-shadow: 1px 1px 0 var(--ink);
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
	}
	dialog {
		border: 0;
		padding: 0;
		background: transparent;
		max-width: min(400px, calc(100vw - 2rem));
		width: 100%;
	}
	dialog::backdrop {
		background: rgba(20, 33, 61, 0.45);
	}
	.sheet {
		position: relative;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 6px 6px 0 var(--ink);
		padding: 1rem;
		display: grid;
		gap: 0.7rem;
	}
	.sheet h3 {
		margin: 0;
		padding-right: 2rem;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.lbl {
		font-weight: 700;
	}
	.sw {
		min-width: 5.2rem;
		height: 2.2rem;
		padding: 0 0.8rem;
		border-radius: 999px;
		border: 2px solid var(--ink);
		background: #fde0dc;
		box-shadow: 2px 2px 0 var(--ink);
		font-weight: 800;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.sw.on {
		background: #d8f5e2;
	}
	.sw:disabled {
		opacity: 0.6;
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
	.toast {
		position: fixed;
		left: 50%;
		bottom: 3rem;
		transform: translateX(-50%);
		z-index: 80;
		cursor: pointer;
	}
	.verr {
		background: #fde0dc;
		border: 2px solid var(--ink);
		border-radius: 8px;
		padding: 0.2rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.faces {
		display: none;
	}
	.vinvite {
		position: fixed;
		bottom: 3rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 82;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		flex-wrap: wrap;
		justify-content: center;
		max-width: calc(100vw - 2rem);
		padding: 0.5rem 0.9rem;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 16px;
		box-shadow: 4px 4px 0 var(--ink);
		animation: vinvite-in 0.25s ease both;
	}
	@keyframes vinvite-in {
		from {
			opacity: 0;
			transform: translate(-50%, 8px);
		}
	}
	.vinvite-txt {
		font-size: 0.9rem;
		font-weight: 600;
	}
	.vinvite-acts {
		display: flex;
		gap: 0.4rem;
	}
</style>
