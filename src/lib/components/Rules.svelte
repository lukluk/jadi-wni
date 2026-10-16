<script>
	import {
		formatRp,
		START_MONEY,
		SALARY,
		JAIL_FINE,
		MAX_PLAYERS,
		MIN_PLAYERS,
		SAWIT_SALARY_BONUS,
		SAWIT_COST_MULT,
		SAWIT_CITIES,
		STATION_RENT,
		UTILITY_MULT,
		STOCKS,
		WIN_NETWORTH
	} from '$lib/shared/board.js';

	let open = $state(false);
	let dialog = $state();
	$effect(() => {
		if (open) dialog?.showModal();
	});
</script>

<button class="book" onclick={() => (open = true)} aria-label="Baca aturan main" title="Aturan main">📖</button>

{#if open}
	<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && dialog.close()}>
		<div class="sheet">
			<h3>📖 Aturan Main Jadi WNI</h3>
			<div class="body">
				<section>
					<h4>🎯 Tujuan</h4>
					<p>Jadi WNI paling sukses: kumpulkan kekayaan sebanyak-banyaknya, sampai pemain lain bangkrut. Uang dihitung dalam <b>juta rupiah (jt)</b>; 1.000 jt = Rp 1 M.</p>
					<ul>
						<li><b>Menang otomatis</b> kalau kekayaan bersihmu tembus <b>{formatRp(WIN_NETWORTH)}</b>.</li>
						<li>Atau jadi pemain terakhir yang belum bangkrut / keluar.</li>
						<li>Atau saat host menekan <i>Akhiri game</i>: pemenang = kekayaan bersih terbesar.</li>
						<li><b>Kekayaan bersih</b> = uang + harga properti + bangunan yang sudah dibangun + nilai saham.</li>
					</ul>
				</section>

				<section>
					<h4>🧑‍🤝‍🧑 Mulai</h4>
					<p>{MIN_PLAYERS}–{MAX_PLAYERS} pemain. Tiap pemain mulai dengan <b>{formatRp(START_MONEY)}</b>. Urutan main diacak saat game dimulai. Ajak teman lewat kode room / link undangan di kartu host.</p>
				</section>

				<section>
					<h4>🎲 Giliran</h4>
					<ul>
						<li>Lempar 2 dadu, bidakmu maju berlawanan arah jarum jam sebanyak angka dadu.</li>
						<li><b>Dobel</b> (dua dadu sama) = boleh lempar lagi. Dobel <b>3 kali berturut-turut</b> = dicurigai ngebut, langsung ke Ruang Sidang.</li>
						<li>Selesaikan aksimu (beli, bayar sewa, dll), lalu tekan <i>Selesai giliran</i>. Sebelum atau sesudah lempar dadu kamu bebas bangun, gadai, jual rumah, dagang saham, atau main di Pasar.</li>
						<li>Saldo minus? Kamu tidak bisa lempar dadu atau menyelesaikan giliran sebelum utang lunas (jual rumah, gadai, atau menyerah).</li>
					</ul>
				</section>

				<section>
					<h4>🗺️ Petak di papan</h4>
					<ul>
						<li><b>GAJIAN</b> — tiap kali melewati / mendarat di sini terima <b>{formatRp(SALARY)}</b>, ditambah <b>{formatRp(SAWIT_SALARY_BONUS)}</b> untuk setiap Kebun Sawit yang kamu punya.</li>
						<li><b>Kota</b> (berwarna) — boleh dibeli, bisa dibangun rumah.</li>
						<li><b>Stasiun</b> (KRL, TJ, MRT, Whoosh) dan <b>Utilitas</b> (PLN, PDAM) — boleh dibeli, sewa bergantung jumlah yang kamu punya.</li>
						<li><b>Pajak</b> — Bayar PBB dan PPnBM, uangnya masuk <b>Kas Negara</b>.</li>
						<li><b>Musibah ⚡ / Takdir 🍀</b> — ambil kartu acak, ikuti efeknya.</li>
						<li><b>Bansos Cair</b> — ambil <b>semua uang di Kas Negara</b>.</li>
						<li><b>Kena Razia!</b> — langsung ke Ruang Sidang Tilang.</li>
						<li><b>Ruang Sidang Tilang</b> — kalau cuma lewat, aman.</li>
					</ul>
				</section>

				<section>
					<h4>🏷️ Beli & sewa</h4>
					<ul>
						<li>Mendarat di petak yang belum ada pemiliknya: boleh <b>beli</b> sesuai harga yang tertera, atau lewati.</li>
						<li>Mendarat di petak milik pemain lain: kamu harus <b>membayar sewa</b> (tekan tombol Bayar). Batas waktu <b>2 menit</b>; kalau habis, kamu dianggap menyerah.</li>
						<li>Sewa kota: tanah kosong = sewa dasar, <b>2×</b> kalau pemiliknya menguasai semua kota satu grup warna, lalu naik sesuai level bangunan.</li>
						<li>Sewa stasiun: {STATION_RENT.slice(1).map((r) => formatRp(r)).join(' / ')} untuk punya 1 / 2 / 3 / 4 stasiun.</li>
						<li>Sewa utilitas: {UTILITY_MULT[1]}× angka dadu (punya 1), {UTILITY_MULT[2]}× (punya keduanya).</li>
						<li>Petak yang sedang <b>digadai</b> bebas sewa. Kalau pemiliknya sedang di Ruang Sidang, sewanya <b>disita ke Kas Negara</b>.</li>
					</ul>
				</section>

				<section>
					<h4>🏠 Membangun</h4>
					<ul>
						<li>Kuasai <b>semua kota satu grup warna</b>, lalu klik petakmu untuk membangun.</li>
						<li>Urutan: Rumah Subsidi 🏚️ → Tipe 45 🏠 → Cluster 🏡 → Rumah OKB 🏰.</li>
						<li>Bangun harus <b>merata</b> di satu grup, dan tidak bisa kalau ada petak di grup itu yang digadai.</li>
						<li><b>Kebun Sawit 🌴</b> hanya di {SAWIT_CITIES.join(', ')}: biaya bangun {SAWIT_COST_MULT}× lipat, tapi menambah gaji GAJIAN {formatRp(SAWIT_SALARY_BONUS)} per kebun. Awas <b>Karhutla</b> (kartu Musibah): semua Kebun Sawit hangus jadi Rumah OKB dan pemiliknya kena denda.</li>
						<li>Menjual rumah mengembalikan <b>separuh</b> biaya bangunnya (juga harus merata).</li>
					</ul>
				</section>

				<section>
					<h4>🏦 Gadai</h4>
					<p>Butuh uang cepat? Gadai petak ke Pegadaian dan terima <b>separuh harga</b>. Menebusnya butuh harga gadai <b>+10%</b>. Petak yang digadai tidak menghasilkan sewa. Tidak bisa digadai kalau masih ada rumah di grup itu.</p>
				</section>

				<section>
					<h4>⚖️ Ruang Sidang Tilang</h4>
					<ul>
						<li>Masuk kalau mendarat di Razia, kena kartu Musibah, atau dobel 3 kali.</li>
						<li>Cara keluar: lempar <b>dobel</b>, bayar <b>denda {formatRp(JAIL_FINE)}</b> (masuk Kas Negara), pakai kartu <b>Pemutihan</b>, atau otomatis bayar denda setelah 3 giliran.</li>
						<li>Selama di Ruang Sidang kamu tetap boleh bangun, gadai, dan berdagang.</li>
					</ul>
				</section>

				<section>
					<h4>🃏 Kartu Musibah & Takdir</h4>
					<p>Musibah: bayar tagihan, mundur, kena razia, banjir/atap bocor (bayar per rumah), kondangan, sampai Karhutla. Takdir: THR, undian, bonus, maju ke petak tertentu, naik transportasi (stasiun terdekat, sewa 2×), dan kartu <b>Pemutihan</b> yang bisa disimpan untuk bebas dari Ruang Sidang atau dijual di Pasar.</p>
				</section>

				<section>
					<h4>🛒 Pasar</h4>
					<ul>
						<li>Jual asetmu (petak atau kartu Pemutihan) dengan memasang harga di tab <b>Pasar</b>. Pemain lain bisa <b>beli langsung</b> atau <b>menawar</b>; kamu bisa terima atau tolak tawaran.</li>
						<li>Petak yang sudah ada bangunannya atau sedang digadai tidak bisa dijual: jual rumah / tebus dulu.</li>
					</ul>
				</section>

				<section>
					<h4>📈 Saham</h4>
					<ul>
						<li>Beli dan jual saham per <b>lot</b> di tab <b>Portofolio</b>: {STOCKS.map((s) => s.sym).join(', ')}.</li>
						<li>Harga bergerak acak tiap giliran (candle hijau naik, merah turun). Saham volatil bisa untung besar, bisa juga anjlok.</li>
						<li>Nilai saham ikut dihitung dalam kekayaan bersih.</li>
					</ul>
				</section>

				<section>
					<h4>🎰 Judol</h4>
					<p>Di tab Portofolio kamu bisa bertaruh berapa pun dari saldomu. Hasilnya acak <b>−100% sampai +100%</b> dari taruhan, ditampilkan sebagai mesin slot. Rata-rata impas, tapi bisa habis semua. Judi itu merusak, di game pun begitu. 😅</p>
				</section>

				<section>
					<h4>💸 Utang, menyerah & bangkrut</h4>
					<ul>
						<li>Saldo minus harus ditutup dengan jual rumah, gadai, atau jual saham.</li>
						<li>Tombol <b>Menyerah</b> (pojok kanan-bawah) menjual semua asetmu otomatis untuk membayar tagihan. Kalau masih ada sisa, kamu lanjut main hanya dengan sisa uang itu. Kalau tidak cukup, kamu <b>bangkrut</b>: asetmu jatuh ke penagih (atau ke bank kalau tidak ada penagih).</li>
						<li>Tanpa utang sama sekali, menyerah berarti keluar dari game.</li>
					</ul>
				</section>

				<section>
					<h4>🗳️ Voting keluarkan pemain</h4>
					<p>Kalau ada pemain yang menggantung game, ajukan voting dengan ikon 🗳️ di kartunya (minimal 3 pemain aktif). Butuh <b>70%</b> setuju dalam 45 detik. Pemain yang offline juga bisa dilewati gilirannya.</p>
				</section>

				<section>
					<h4>💡 Lain-lain</h4>
					<ul>
						<li>Penanda avatar mini di papan hanya terlihat olehmu sendiri: tanda aset yang kamu punya, tersambung garis ke tiap petaknya.</li>
						<li>Ikon ⚙️ di pojok kanan-bawah: efek suara, obrolan suara, mikrofon, dan video.</li>
						<li>Ticker <b>Netizen</b> di bawah: komentar dan saran dari netizen tentang permainanmu, diperbarui tiap 5 menit.</li>
					</ul>
				</section>
			</div>
			<button class="close" onclick={() => dialog.close()} aria-label="Tutup">✕</button>
		</div>
	</dialog>
{/if}

<style>
	.book {
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: 50%;
		border: 2px solid var(--ink);
		background: #fff;
		box-shadow: 2px 2px 0 var(--ink);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}
	dialog {
		border: 0;
		padding: 0;
		background: transparent;
		max-width: min(640px, calc(100vw - 2rem));
		width: 100%;
	}
	dialog::backdrop {
		background: rgba(20, 33, 61, 0.45);
	}
	.sheet {
		text-align: left;
		position: relative;
		background: var(--paper);
		border: 3px solid var(--ink);
		border-radius: 12px;
		box-shadow: 6px 6px 0 var(--ink);
		padding: 1rem 0.5rem 1rem 1rem;
		display: grid;
		gap: 0.6rem;
		max-height: calc(100dvh - 3rem);
		grid-template-rows: auto minmax(0, 1fr);
	}
	h3 {
		margin: 0;
		text-align: left;
		padding-right: 2.2rem;
	}
	.body {
		overflow-y: auto;
		padding-right: 0.6rem;
		display: grid;
		gap: 0.9rem;
		font-size: 0.9rem;
		line-height: 1.45;
	}
	h4 {
		margin: 0 0 0.25rem;
		font-size: 0.95rem;
	}
	section p {
		margin: 0;
	}
	ul {
		margin: 0;
		padding-left: 1.1rem;
		display: grid;
		gap: 0.25rem;
	}
	.close {
		position: absolute;
		top: 0.6rem;
		right: 0.8rem;
		width: 2rem;
		height: 2rem;
		border: 2px solid var(--ink);
		border-radius: 50%;
		background: #fff;
		cursor: pointer;
	}
</style>
