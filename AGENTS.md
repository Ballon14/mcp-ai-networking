# AGENTS.md — Panduan Kerja Proyek mcp-ai

Dokumen ini adalah kontrak kerja untuk semua agent/AI yang mengerjakan repo ini. Baca sebelum mengubah kode.

## 1. Tujuan Proyek

MCP (Model Context Protocol) server **read-only** untuk MikroTik RouterOS v7 melalui REST API. Server berjalan di atas stdio, mendukung banyak router, dan dipakai oleh aplikasi AI custom (Node.js/OpenAI).

Repo: `Ballon14/mcp-ai-networking` — branch utama: `main`.

## 2. Aturan yang Tidak Boleh Dilanggar

1. **Read-only mutlak di v1.** Jangan menambahkan operasi yang mengubah konfigurasi router (set/add/remove/reboot/script/console command bebas).
2. **Guard di `src/routeros/client.mjs` wajib dipertahankan**: hanya `GET`, ditambah allowlist ketat `POST /rest/ping`. Jangan membuat bypass/escape hatch.
3. **Jangan pernah** menulis, mencetak, atau meng-commit password, token, private key, atau isi `.env` / `mikrotik.config.json`.
4. **Jangan expose `www-ssl` ke internet** dalam dokumentasi/contoh. Akses hanya LAN/VPN.
5. **Tool baru wajib**: `readOnlyHint: true`, `destructiveHint: false`, validasi zod, output JSON dengan `summary` + `device`, pagination, dan redaksi data sensitif.
6. **Jangan menambah dependency runtime baru** tanpa persetujuan user. Saat ini hanya `@modelcontextprotocol/sdk` dan `zod`.
7. **Jangan menulis log ke stdout.** Stdio dipakai protokol MCP; semua log server harus ke stderr.

## 3. Stack & Konvensi Teknis

- Node.js **>= 22** (runtime saat ini Node 24), Windows PowerShell sebagai shell.
- File server/test/example memakai **ESM `.mjs`** walaupun `package.json` bertipe `commonjs`. Pertahankan `.mjs`.
- MCP SDK `1.32.x`: gunakan `server.registerTool(name, config, handler)`, bukan `server.tool` yang deprecated.
- Zod v4 dengan raw shape (`inputSchema: { ... }`), bukan object schema penuh.
- Transport: `StdioServerTransport`.
- Tool name: `snake_case` (contoh `get_dhcp_leases`).
- Field RouterOS: pertahankan nama asli (contoh `dst-address`, `mac-address`).
- Gaya kode: 2 spasi, double quotes, semicolon, tanpa komentar yang tidak perlu.
- Deskripsi/title tool dan pesan error ditulis dalam bahasa Inggris (dibaca model). Dokumentasi user dalam bahasa Indonesia.

## 4. Struktur Proyek

```
src/server.mjs                 Entry point MCP stdio
src/config.mjs                 Loader + validasi mikrotik.config.json/env
src/routeros/client.mjs        REST client read-only (GET guard, TLS, timeout, cache)
src/routeros/errors.mjs        Mapping error HTTP/network yang aman
src/tools/*.mjs                Satu modul per kelompok tool + index.mjs
src/lib/                       normalize, redact, truncate, result helpers
examples/                      MCP client demo + OpenAI bridge + Ollama/Qwen bridge
test/                          node:test + mock RouterOS HTTP server
```

## 5. Perintah Penting

```powershell
npm install
npm test                                   # WAJIB lulus sebelum commit
npm start                                  # jalankan server MCP via stdio
npm run demo                               # smoke test semua koneksi
npm run demo -- system_info '{"device":"core"}'
npm run inspect                            # MCP Inspector
npm run bridge                             # chat OpenAI via MCP
npm run qwen                               # chat Ollama/Qwen lokal via MCP
```

Setup lokal:

```powershell
Copy-Item mikrotik.config.example.json mikrotik.config.json
Copy-Item .env.example .env
# isi password via env ROS_<DEVICE>_PASS, jangan di file config
```

## 6. Cara Menambah Tool Baru

1. Buat/ubah modul di `src/tools/nama.mjs`; daftarkan di `src/tools/index.mjs`.
2. Gunakan `resolveDevice(context, device)` dan `deviceParam` dari `src/tools/common.mjs`.
3. Bungkus handler dengan `toolHandler` dari `src/lib/result.mjs`.
4. Gunakan `pageRows`/`pagingNote` untuk list besar (`limit`, `offset`, `truncated`).
5. Terapkan `redactObject`/`redactText` bila output dapat memuat data sensitif.
6. Kembalikan `jsonResult({ summary, device, ...data })`.
7. Tambahkan fixture + test di `test/` (termasuk kasus error dan filter).
8. Perbarui tabel tool di `README.md`.

Aturan tambahan:

- Setiap tool yang menghubungi router **wajib** menerima parameter opsional `device`.
- Nilai REST RouterOS berupa string; normalisasi angka dengan helper di `src/lib/normalize.mjs` tanpa membuang raw value yang penting.
- Wireless: coba `/rest/interface/wifi/registration-table`, fallback ke `/rest/interface/wireless/registration-table` hanya untuk status 400/404.
- Batas output: default `config.maxRows` (200), maksimum `limit` 500; `get_logs` default 50.
- Jangan mengubah urutan firewall rule; urutan bersifat semantik.

## 7. Testing

- Framework: `node:test` (built-in), tanpa jaringan/real router.
- Gunakan `test/helpers/mock-routeros.mjs` + `createFixtures()`.
- Test wajib mencakup: auth, read-only guard, error mapping, filter/pagination, redaksi, dan bentuk output JSON.
- Jalankan `npm test` dan pastikan **semua test lulus** sebelum commit.
- Jalankan `node --check` untuk file `.mjs` baru.

## 8. Git & Push Otomatis (Standing Instruction dari User)

User meminta: **setiap task yang selesai langsung di-commit dan di-push ke GitHub.**

Lakukan langkah berikut setiap menyelesaikan task:

1. `git status --short` dan review `git diff` — pastikan hanya file yang dimaksud yang berubah.
2. Pastikan tidak ada secret: `.env`, `mikrotik.config.json`, file `*.db`, log, kredensial, key.
3. Jalankan `npm test`; jangan commit jika gagal.
4. Stage file yang relevan (`git add <file...>`; hindari `git add -A` jika ada file lokal).
5. Commit dengan format Conventional Commits:
   - `feat: ...` fitur/tool baru
   - `fix: ...` perbaikan bug
   - `test: ...` test saja
   - `docs: ...` dokumentasi
   - `chore: ...` tooling/konfigurasi
   Contoh: `feat: add ipv6 firewall filter tool`
6. Sinkronkan bila perlu: `git pull --rebase origin main`.
7. Push: `git push origin main`.
8. Laporkan ke user: hash commit, ringkasan perubahan, dan status push.

Larangan git:

- Jangan force-push, rebase branch yang sudah di-push, atau mengubah history.
- Jangan commit `node_modules/`, `.env`, `mikrotik.config.json`, `*.log`, `*.db`.
- Jangan membuat tag/release/PR kecuali diminta eksplisit.
- Jika push gagal (auth/network), **jangan reset atau hapus commit**; laporkan error dan biarkan commit lokal.
- `gh` CLI tidak terpasang; push memakai `git` + Git Credential Manager (remote HTTPS).

## 9. Definition of Done

Sebuah task dianggap selesai hanya jika:

- Perubahan sesuai plan dan aturan read-only.
- Test baru/terkait lulus (`npm test`).
- README diperbarui bila perilaku/tool berubah.
- Tidak ada secret atau file lokal yang ter-commit.
- Commit dibuat dan berhasil di-push ke `origin/main`.

## 10. Roadmap Write Mode (Belum Diizinkan)

Jangan mulai fase write tanpa persetujuan eksplisit user. Urutan wajib nanti:

1. `plan_change` (draft + diff, tanpa eksekusi)
2. `dry_run`
3. `apply_change` dengan confirmation token one-time (TTL 60 detik)
4. Backup otomatis sebelum perubahan
5. `rollback` + audit log + path allowlist (tanpa console command bebas)

## 11. Troubleshooting Cepat

| Gejala | Solusi |
|---|---|
| HTTP 401 | Cek `user` dan env password. |
| HTTP 403 | Policy user: `read,api,rest-api`; tambah `test` untuk ping. |
| HTTP 404 | Menu tidak ada di versi/paket RouterOS. |
| TLS not trusted | Import CA router atau `insecure: true` (lab saja). |
| `Connection closed` | Jalankan `npm start` manual, baca stderr (config/password). |
| Output `truncated` | Persempit filter atau pakai `limit`/`offset`. |
| `timed out` | Naikkan `timeoutMs`, persempit query, cek LAN. |
