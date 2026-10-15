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
- Level rumah: **Rumah Subsidi → Tipe 45 → Cluster → Rumah OKB**. Wajib kuasai satu grup warna, bangun merata.
- **Musibah** (banjir, copet KRL, tilang ganjil-genap, kondangan…) & **Takdir** (THR, lolos CPNS, viral, Pemutihan…), masing-masing 16 kartu.
- Pajak, denda, dan Musibah masuk **Kas Negara** (di tengah papan); mendarat di *Bansos Cair* ambil semuanya.
- Selama pemilik di Ruang Sidang, sewa asetnya **disita ke Kas Negara**, bukan ke pemilik.
- *Kena Razia* / dobel 3× → **Ruang Sidang Tilang**: bayar denda Rp 50 jt, pakai kartu Pemutihan, atau coba dobel (maks 3 giliran).
- Gadai ke Pegadaian 50%, tebus 55%. Saldo minus wajib dilunasi sebelum lanjut, atau bangkrut (aset disita bank).
- Host bisa mengakhiri game; pemenang = kekayaan bersih terbesar. Pemain offline bisa dilewati gilirannya oleh pemain lain.

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
- Saat bangkrut ke pemain lain, aset kembali ke bank (bukan ke kreditur).

## Tes

```bash
npm run test:engine
```
