# Jadi WNI

Monopoli multiplayer realtime bertema hidup sebagai WNI. SvelteKit (Svelte 5) + Socket.IO + SQLite, login Google, undang teman via link.

## Jalankan lokal

```bash
cp .env.example .env      # isi GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
npm install
npm run dev               # http://localhost:5173
```

Butuh Node ≥ 22.13 (pakai `node:sqlite` bawaan, tanpa native build).

Tanpa kredensial Google, set `ALLOW_DEV_LOGIN=true` untuk login tamu (buka 2 browser/incognito untuk tes multiplayer). **Matikan di production.**

## Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).
2. Authorized redirect URI: `${ORIGIN}/auth/google/callback` (mis. `http://localhost:5173/auth/google/callback`).
3. Scope: `openid profile email`.

## Production

```bash
npm run build
ORIGIN=https://wni.example.com GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... PORT=3000 npm start
```

`server.js` menjalankan handler SvelteKit dan Socket.IO di port yang sama. Di belakang reverse proxy, teruskan header WebSocket (`Upgrade`/`Connection`) untuk path `/socket.io`.

## Deploy ke Kubernetes

`Dockerfile`, `deploy/k8s.yaml` (Namespace, ConfigMap, PVC, Deployment, Service, Ingress), dan `deploy/deploy.sh`. Target: <https://jadi-wni.pinuspintar.com>.

```bash
docker login -u luklukls
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ./deploy/deploy.sh   # image: luklukls/jadi-wni:<git sha>
# REGISTRY=... untuk registry lain, DRY_RUN=1 untuk hanya mencetak manifest
```

Syarat cluster: ingress-nginx (`INGRESS_CLASS`), cert-manager dengan ClusterIssuer `letsencrypt-prod` (`CLUSTER_ISSUER`, isi `-` untuk lewati), dan StorageClass default (atau `STORAGE_CLASS`). Aplikasi harus **1 replika** (state room di memori + SQLite di PVC `/data`). Daftarkan redirect URI `https://jadi-wni.pinuspintar.com/auth/google/callback` di Google OAuth dan arahkan DNS ke ingress.

## Struktur

```
server/
  config.js        env loader
  db.js            SQLite: users, sessions, rooms (state game JSON)
  socket.js        room, invite, presence, chat, dispatch aksi
  game/engine.js   aturan main (server-authoritative)
src/lib/shared/board.js   papan, kartu Musibah/Takdir, level rumah (dipakai server & client)
src/lib/components/       Board, TileSheet, PlayerCard
src/routes/               landing, /room/[code], /auth/*
tests/engine.test.js      300 game acak oleh bot + unit test aturan
```

Semua aturan dijalankan di server; client hanya mengirim intent (`roll`, `buy`, `build`, …) dan menerima state penuh tiap perubahan.

## Aturan

- 2–6 pemain, saldo awal Rp 1.500 jt, lewat **GAJIAN** +Rp 200 jt.
- Properti: 22 kota (Cikarang → SCBD), 4 stasiun (KRL, Transjakarta, MRT, Whoosh), PLN & PDAM.
- **Pasar**: pemilik menjual aset lewat popup detail petak (isi harga, bisa diubah/ditarik); di tab **Pasar** pembeli klik Beli atau Nego (kirim tawaran), penjual terima/tolak. Aset digadai atau satu grup dengan rumah tidak bisa dijual.
- Tab **Portofolio**: daftar semua asetmu + saham plesetan (BACA, BIBR, ASIK, GATO) yang harganya naik-turun tiap giliran. Beli saham memotong saldo; uang kembali hanya kalau kamu Jual. Nilai saham ikut dihitung di kekayaan bersih.
- Level rumah: **Rumah Subsidi → Tipe 45 → Cluster → Rumah OKB → Kebun Sawit 🌴**. Wajib kuasai satu grup warna, bangun merata. Kebun Sawit level tertinggi: biaya bangun 3× lipat, sewa 1,5× Rumah OKB, dan tiap kebun menambah gaji GAJIAN +30 jt.
- **Musibah** (banjir, copet KRL, tilang ganjil-genap, kondangan…) & **Takdir** (THR, lolos CPNS, viral, Pemutihan…), masing-masing 16 kartu.
- **Sewa tidak otomatis**: mendarat di aset pemain lain memunculkan popup tagihan (nama aset, pemilik, tarif, level) dengan tombol **Bayar**; tidak ada tombol lewati. Kalau uang kurang, jual rumah / gadai / jual aset / jual saham dulu, atau **Menyerah**: semua aset sisa jadi milik pemilik yang menagih. Waktu menyelesaikan tagihan **2 menit** (dihitung server); habis = otomatis menyerah.
- Pajak, denda, dan Musibah masuk **Kas Negara** (di tengah papan); mendarat di *Bansos Cair* ambil semuanya.
- Selama pemilik di Ruang Sidang, sewa asetnya **disita ke Kas Negara**, bukan ke pemilik.
- *Kena Razia* / dobel 3× → **Ruang Sidang Tilang**: bayar denda Rp 50 jt, pakai kartu Pemutihan, atau coba dobel (maks 3 giliran).
- Gadai ke Pegadaian 50%, tebus 55%. Saldo minus wajib dilunasi sebelum lanjut, atau bangkrut (aset disita bank).
- **Vote kick**: saat game berjalan (min. 3 pemain aktif) siapa pun bisa klik 🗳️ di kartu pemain lain. Pemain itu dikeluarkan kalau minimal **70% pemain lain** setuju dalam 45 detik (target tidak ikut memilih; asetnya disita bank). Satu voting dalam satu waktu, ada jeda 30 detik setelah voting gagal.
- Host bisa mengakhiri game; pemenang = kekayaan bersih terbesar. Pemain offline bisa dilewati gilirannya oleh pemain lain.

## Obrolan suara (WebRTC)

Tombol **🎙️ Gabung suara** di kiri bawah (di lobi maupun saat main). Audio peer-to-peer (mesh, cocok untuk 2-6 pemain); server Socket.IO hanya meneruskan sinyal (`voice:*` di `server/socket.js`), klien di `src/lib/components/Voice.svelte`. Kartu pemain menyala hijau saat bicara, ada tombol mic nyala/mati.

- **Video opsional**: setelah gabung suara, tombol **📷 Kamera** menyalakan webcam (320x240, 15 fps) dan wajah-wajah kecil muncul di bawah kiri. Pemain tanpa kamera tidak punya kotak wajah. Kamera bisa dinyalakan/dimatikan kapan saja (renegosiasi memakai pola *perfect negotiation*).
- Mikrofon hanya jalan di **HTTPS** atau `localhost`.
- Memakai STUN publik Google. Pemain di jaringan ketat (NAT simetris/kantor) butuh server TURN: tambahkan ke `ICE` di `Voice.svelte`.

## Efek suara

File di `static/sounds/*.mp3`, diambil dari paket **Interface Sounds** dan **Casino Audio** milik [Kenney.nl](https://kenney.nl) (lisensi CC0, bebas dipakai tanpa atribusi; salinan lisensi ada di folder yang sama). Dikonversi ke mp3 mono kecil (total ~100 KB). Pemutar ada di `src/lib/sound.js`, tombol 🔊/🔇 di pojok kiri bawah (pilihan disimpan di browser).

## Foto kota

Tiap kota memakai foto utama artikel Wikipedia-nya (hanya gambar berlisensi bebas dari Wikimedia Commons). Server mengambilnya saat start, menyimpan ke SQLite, dan memperbarui tiap 30 hari. Kredit pembuat + lisensi tampil di detail petak.

Ganti foto tertentu lewat `server/city-images.overrides.json`:

```json
{ "SCBD": { "url": "https://…/scbd.jpg", "credit": "Nama fotografer", "license": "CC BY 4.0", "page": "https://…" } }
```

Kalau server tidak bisa mengakses Wikipedia, papan tetap jalan dengan warna grup saja.

## Batasan saat ini

- Belum ada trading antar pemain dan lelang properti yang dilewati.
- Satu instance. Untuk scale-out butuh `@socket.io/redis-adapter`, sticky session, dan state room dipindah ke Redis/DB bersama.
- Chat tidak dipersist; state game dipersist ke SQLite tiap aksi (aman saat restart).
- Bangkrut biasa: aset kembali ke bank. Menyerah saat ditagih sewa: aset ke penagih.

## Tes

```bash
npm run test:engine
```
