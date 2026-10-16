<script>
	import { onMount } from 'svelte';
	import { getSocket } from '$lib/socket.js';

	/** @type {{ meId: string, players?: {id:string, name:string, color:string}[], speaking?: Record<string, boolean>, members?: string[] }} */
	let { meId, players = [], speaking = $bindable({}), members = $bindable([]) } = $props();

	// STUN publik; kalau ada pemain di jaringan ketat (NAT simetris) butuh server TURN sendiri
	const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
	const SPEAK_LEVEL = 0.035;

	let joined = $state(false);
	let muted = $state(false);
	let busy = $state(false);
	let error = $state('');
	let camOn = $state(false);
	/** @type {MediaStream|null} */
	let selfCam = $state(null);
	/** @type {{sid:string, userId:string, stream:MediaStream, hasVideo:boolean}[]} */
	let peers = $state([]);
	const nameOf = (id) => players.find((p) => p.id === id)?.name ?? 'Pemain';

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
			local = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});
			const res = await new Promise((resolve) =>
				sock()
					.timeout(8000)
					.emit('voice:join', null, (err, r) => resolve(err ? { ok: false, error: 'Server tidak merespons.' } : r))
			);
			if (!res.ok) throw new Error(res.error);
			joined = true;
			muted = false;
			addMeter('me', meId, local);
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
		const onDisconnect = () => cleanup(false);
		s.on('voice:signal', onSignal);
		s.on('voice:peer-left', onLeft);
		s.on('voice:members', onMembers);
		s.on('disconnect', onDisconnect);
		s.emit('voice:query', null, (r) => r?.members && (members = r.members));
		return () => {
			s.off('voice:signal', onSignal);
			s.off('voice:peer-left', onLeft);
			s.off('voice:members', onMembers);
			s.off('disconnect', onDisconnect);
			cleanup(true);
		};
	});
</script>

<div class="voice">
	{#if !joined}
		<button class="vbtn" onclick={join} disabled={busy} aria-label="Gabung obrolan suara" title="Gabung obrolan suara">
			🎙️ {busy ? 'Menyambung…' : 'Gabung suara'}{#if members.length}<span class="cnt">{members.length}</span>{/if}
		</button>
	{:else}
		<button class="vbtn on" class:muted onclick={toggleMute} aria-pressed={muted} title={muted ? 'Mikrofon mati' : 'Mikrofon nyala'}>
			{muted ? '🔇 Mic mati' : '🎙️ Mic nyala'}
		</button>
		<button class="vbtn on" class:muted={!camOn} onclick={toggleCamera} aria-pressed={camOn} title="Kamera (opsional)">{camOn ? '📷 Kamera nyala' : '📷 Kamera'}</button>
		<button class="vbtn" onclick={() => cleanup(true)} title="Keluar dari obrolan suara">Keluar suara</button>
	{/if}
	{#if error}<span class="verr" role="alert">{error}</span>{/if}
</div>

<!-- wajah-wajah kecil di bawah; peer tanpa kamera tetap punya elemen untuk memutar audio (disembunyikan) -->
<div class="faces" class:empty={!camOn && !peers.some((p) => p.hasVideo)}>
	{#if selfCam}
		<figure class="face self" class:talk={speaking[meId]}>
			<video use:attach={selfCam} autoplay playsinline muted></video>
			<figcaption>Kamu</figcaption>
		</figure>
	{/if}
	{#each peers as p (p.sid)}
		<figure class="face" class:novideo={!p.hasVideo} class:talk={speaking[p.userId]}>
			<video use:attach={p.stream} autoplay playsinline></video>
			<figcaption>{nameOf(p.userId)}</figcaption>
		</figure>
	{/each}
</div>

<style>
	.voice {
		position: fixed;
		left: 3.9rem;
		bottom: 0.75rem;
		z-index: 60;
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		max-width: calc(100vw - 5rem);
	}
	.vbtn {
		height: 2.4rem;
		padding: 0 0.75rem;
		border-radius: 999px;
		border: 2px solid var(--ink);
		background: #fff;
		box-shadow: 2px 2px 0 var(--ink);
		font-weight: 800;
		font-size: 0.8rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.vbtn.on {
		background: #d8f5e2;
	}
	.vbtn.on.muted {
		background: #fde0dc;
	}
	.vbtn:disabled {
		opacity: 0.6;
	}
	.cnt {
		background: var(--merah);
		color: #fff;
		border-radius: 999px;
		padding: 0 0.4rem;
		font-size: 0.7rem;
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
		position: fixed;
		left: 0.75rem;
		bottom: 3.6rem;
		z-index: 59;
		display: flex;
		gap: 0.4rem;
		max-width: calc(100vw - 1.5rem);
		overflow-x: auto;
		pointer-events: none;
	}
	.faces.empty {
		display: none;
	}
	.face {
		margin: 0;
		position: relative;
		width: 6.2rem;
		aspect-ratio: 4 / 3;
		border: 2px solid var(--ink);
		border-radius: 10px;
		overflow: hidden;
		background: #222;
		box-shadow: 2px 2px 0 var(--ink);
		flex: none;
	}
	.face.novideo {
		display: none;
	}
	.face.talk {
		border-color: #1f8a4c;
		box-shadow: 0 0 0 3px #1f8a4c;
	}
	.face video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.face.self video {
		transform: scaleX(-1);
	}
	.face figcaption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 0 0.3rem;
		font-size: 0.65rem;
		font-weight: 700;
		color: #fff;
		background: rgba(0, 0, 0, 0.55);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
