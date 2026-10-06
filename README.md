# Syptek

Jalankan: `npm install` lalu `npm start`.

## Pintasan
| Tombol | Fungsi |
|---|---|
| Ctrl+T / Ctrl+W | Tab baru / tutup tab |
| Ctrl+L | Fokus ke address bar |
| Ctrl+D | Tambah / hapus bookmark |
| Ctrl+H | Riwayat (`syptek://history`) |
| Ctrl+Shift+O | Bookmark (`syptek://bookmarks`) |
| Ctrl+Shift+T | Buka kembali tab yang ditutup |
| Ctrl+E / Ctrl+Shift+E | Ganti mesin pencari (maju / mundur) |
| Alt+1 … Alt+9 | Pilih mesin pencari langsung (urutan di `searchEngines`) |
| ↑ / ↓ di address bar | Pilih saran |
| Ctrl+P | Cetak |
| Ctrl+Tab | Pindah tab |
| Seret tab | Ubah urutan tab (urutan ikut tersimpan di sesi) |

## Halaman internal
`syptek://history`, `syptek://bookmarks`, `syptek://about` (versi & hak cipta), `syptek://credits` (daftar kredit & lisensi, dibaca otomatis dari dependensi produksi). About/Kredit juga ada di menu (⋯).

## Info & izin situs
Tombol di kiri address bar (ikon penyetel) membuka menu izin untuk situs yang sedang dibuka: mikrofon, kamera, lokasi, clipboard (Tanya / Izinkan / Blokir), reset izin situs itu saja, dan muat ulang. Notifikasi selalu diblokir.

## config.json (tambahan)
- `identity.clientHints`: UA + Client Hints ala Chrome (lewat CDP). Matikan hanya untuk uji coba login Google.
- `searchEngine` (id mesin awal), `searchEngines` (daftar: `id`, `name`, `url`, `suggest`; `%s` = kata kunci). Pilihan terakhir tersimpan di `session.json`.
- `suggestions.enabled`, `suggestions.remote`: dropdown saran di address bar. `remote: false` = hanya riwayat & bookmark, tidak ada ketikan yang dikirim ke mesin pencari.
- `restoreTabs`: buka kembali tab terakhir saat Syptek dijalankan (tab dimuat saat dibuka, jadi startup tetap ringan).
- `history.enabled`, `history.maxEntries`: riwayat aktif/tidak dan batas jumlah entri (yang terlama dibuang).
- `tabSuspend.enabled`, `tabSuspend.afterMinutes`: tab latar belakang yang menganggur selama N menit
  ditidurkan (RAM dibebaskan). Tab yang sedang memutar audio, memuat, atau membuka DevTools tidak ditidurkan.

Data riwayat & bookmark disimpan sebagai `history.json` dan `bookmarks.json` di folder userData Electron.

Izin situs (kamera, mikrofon, lokasi, clipboard) disimpan di `permissions.json`, tab terakhir di `session.json`; reset izin lewat menu.
Unduhan disimpan otomatis ke folder Downloads.

## Build (Syptek.exe)
`npm run build` membuat `dist/Syptek-win32-x64/Syptek.exe`. Dengan build ini Task Manager menampilkan "Syptek", bukan "Electron"
(saat `npm start`, subproses Chromium memakai nama `electron.exe` bawaan). Ikon bisa ditambah dengan `--icon=icon.ico` pada skrip build.
Di versi build, `config.json` ada di `resources/app/`. DevTools (F12) terbelah di kanan jendela (di bawah kalau jendela sempit).

## Ikon & logo
- `icon.ico` (folder proyek): ikon jendela/taskbar saat `npm start` dan ikon `Syptek.exe` / desktop saat `npm run build`. Buat multi-ukuran (16, 24, 32, 48, 64, 128, 256 px). Letakkan sebelum build, karena skrip build memakai `--icon=icon.ico`.
- `renderer/logo.png` (PNG persegi, 256 atau 512 px): logo di halaman `syptek://about`. Kalau file ini belum ada, dipakai logo SVG bawaan.

## Data lama (Sift)
Saat pertama kali dijalankan, data dari folder `Sift` di `%APPDATA%` (riwayat, bookmark, sesi, izin, login) disalin otomatis ke folder `Syptek`. Folder lama tidak dihapus.
