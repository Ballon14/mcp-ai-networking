# MikroTik MCP Server (Read-Only)

MCP (Model Context Protocol) server untuk membaca konfigurasi dan status **MikroTik RouterOS v7** melalui REST API. Dirancang untuk menghubungkan AI (custom app Node.js, OpenAI API, Claude Desktop, opencode, dan client MCP lain) ke beberapa router sekaligus, tanpa memberi akses tulis ke konfigurasi.

```
Custom AI app (.mjs)  ──MCP stdio──>  mcp-ai server  ──HTTPS REST──>  RouterOS v7
      (OpenAI API)                     (Node.js ESM)               (multi-router)
```

## Fitur

- 10 tool read-only: system info, interfaces, routes, firewall, DHCP, DNS, wireless, logs, ping, daftar device.
- Multi-device: setiap tool menerima parameter `device` (default `defaultDevice`).
- Read-only ditegakkan dua lapis: guard HTTP di kode (hanya GET + allowlist `POST /rest/ping`) dan user RouterOS dengan policy minimal.
- Kredensial hanya dari environment variable; tidak pernah ditulis ke config atau log.
- Redaksi otomatis field sensitif (`password`, `secret`, `pre-shared-key`, `community`, dll.) dan pola `password=...` di log.
- Output dibatasi (`limit`/`offset`, `truncated`) agar context model tidak jebol.
- TLS verification aktif secara default; opsi `insecure` khusus lab.
- Tanpa dependency tambahan selain MCP SDK dan zod.

## Prasyarat

- Node.js **22 atau lebih baru** (dikembangkan dan diuji di Node 24).
- RouterOS **v7.1beta4+** dengan service `www-ssl` aktif (REST API).
- Server MCP berada di LAN yang sama (atau VPN) dengan router.
- Port 443 router hanya dapat diakses dari host server MCP.

## Setup RouterOS

### 1. Aktifkan REST API lewat HTTPS

Buat/aktifkan sertifikat untuk `www-ssl` (Winbox: System > Certificates, atau buat self-signed), lalu:

```
/ip service set www-ssl disabled=no certificate=<nama-sertifikat>
```

Verifikasi dari host server MCP:

```
curl -k -u mcp-read:<password> https://<router-ip>/rest/system/resource
```

Catatan keamanan: REST API juga bisa lewat `www` (HTTP) di v7.9+, tetapi jangan dipakai karena kredensial dapat disadap.

### 2. Buat user read-only

```
/user group add name=mcp-read policy=read,api,rest-api,web,winbox
/user add name=mcp-read group=mcp-read password=<password-kuat>
```

- Tool `ping` membutuhkan policy `test` (RouterOS menganggap ping sebagai operasi test). Tambahkan hanya jika diperlukan:
  ```
  /user group set mcp-read policy=read,api,rest-api,web,winbox,test
  ```
- Jangan berikan `write`, `policy`, `sensitive`, `password`, atau `ftp`.

### 3. Batasi akses jaringan

Contoh aturan firewall agar port 443 hanya bisa diakses host MCP (sesuaikan urutan rule dan IP):

```
/ip firewall filter add chain=input protocol=tcp dst-port=443 src-address=<IP-SERVER-MCP> action=accept comment="MCP read-only server"
```

Jangan expose `www-ssl` ke internet.

## Instalasi & Konfigurasi

```
npm install
```

Salin contoh konfigurasi:

```
Copy-Item mikrotik.config.example.json mikrotik.config.json
Copy-Item .env.example .env
```

Edit `mikrotik.config.json`:

```json
{
  "defaultDevice": "core",
  "maxRows": 200,
  "devices": [
    {
      "name": "core",
      "host": "192.168.88.1",
      "port": 443,
      "user": "mcp-read",
      "passwordEnv": "ROS_CORE_PASS",
      "tls": true,
      "insecure": false,
      "timeoutMs": 10000,
      "minIntervalMs": 250
    },
    {
      "name": "branch",
      "host": "192.168.89.1",
      "port": 443,
      "user": "mcp-read",
      "passwordEnv": "ROS_BRANCH_PASS",
      "tls": true,
      "insecure": false
    }
  ]
}
```

Field penting:

| Field | Arti |
|---|---|
| `name` | Nama device yang dipakai sebagai parameter `device` di tool. |
| `passwordEnv` | Nama environment variable berisi password. Jangan simpan password di file. |
| `insecure` | `true` menonaktifkan verifikasi sertifikat TLS. Hanya untuk lab. |
| `timeoutMs` | Timeout request (default 10000). |
| `minIntervalMs` | Jeda minimum antar-request per device agar router tidak terbebani. |

Isi `.env`:

```
MIKROTIK_CONFIG=./mikrotik.config.json
ROS_CORE_PASS=<password-core>
ROS_BRANCH_PASS=<password-branch>
```

`.env` dan `mikrotik.config.json` sudah masuk `.gitignore`.

## Menjalankan

```
npm start
```

Server berjalan di atas **stdio** (bukan HTTP): AI client yang men-spawn proses ini dan berkomunikasi lewat stdin/stdout. Log server selalu ke stderr.

- Smoke test + daftar tool: `npm run demo`
- Panggil tool tertentu: `npm run demo -- system_info '{"device":"branch"}'`
- Chat via OpenAI: `npm run bridge`
- Chat via Ollama/Qwen lokal: `npm run qwen`
- Debug interaktif: `npm run inspect` (MCP Inspector)
- Test: `npm test`

## Integrasi ke Custom App (.mjs)

Contoh minimal memakai MCP client SDK (sama seperti yang dipakai AI app Anda):

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["D:/riset/mcp-ai/src/server.mjs"],
  env: {
    ...process.env,
    MIKROTIK_CONFIG: "D:/riset/mcp-ai/mikrotik.config.json",
    ROS_CORE_PASS: process.env.ROS_CORE_PASS
  }
});

const client = new Client({ name: "my-ai-app", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({
  name: "system_info",
  arguments: { device: "core" }
});

console.log(result.content);
await client.close();
```

Untuk OpenAI API, pakai `examples/mcp-client-demo.mjs` sebagai acuan dan `examples/openai-bridge.mjs` sebagai implementasi lengkap: tool MCP dikonversi ke OpenAI function-calling, `tool_calls` dieksekusi lewat MCP, lalu hasilnya dikirim kembali ke model.

```
$env:OPENAI_API_KEY = "<key>"
$env:OPENAI_MODEL = "gpt-4.1-mini"   # opsional
npm run bridge
```

Variabel opsional: `OPENAI_BASE_URL` untuk endpoint kompatibel OpenAI.

### Ollama lokal (Qwen3.5)

`examples/qwen-bridge.mjs` memakai Ollama native API (`/api/chat`) dengan tool calling, lalu mengeksekusi tool MCP read-only dan mengirim hasilnya kembali ke model. Model dipilih otomatis dari tag yang mengandung `qwen3.5`; set `QWEN_MODEL` untuk memilih eksplisit.

```
$env:OLLAMA_HOST = "http://10.10.10.21:11434"
$env:QWEN_MODEL  = "qwen3.5:4b"   # opsional, sesuaikan tag di Ollama
npm run qwen
```

Sekali jalan tanpa mode interaktif:

```
npm run qwen -- "Ringkas kondisi router core"
```

Agar Ollama menerima koneksi dari mesin lain:

Linux (systemd):

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n' | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Windows (service Ollama):

```
setx OLLAMA_HOST 0.0.0.0:11434
```

Restart Ollama, lalu verifikasi dari host bridge: `curl http://10.10.10.21:11434/api/tags`.

Alternatif tanpa mengubah bind (SSH tunnel):

```
ssh -N -L 11434:127.0.0.1:11434 iqbal@10.10.10.21
```

Lalu set `OLLAMA_HOST=http://127.0.0.1:11434` pada bridge.

Untuk memakai model turunan/custom, misalnya `network-expert:latest`: `$env:QWEN_MODEL="network-expert:latest"`.

Catatan keamanan: Ollama tidak memiliki autentikasi. Jika di-bind ke `0.0.0.0`, siapa pun di LAN dapat memakai model; batasi port 11434 dengan firewall atau VPN.

Variabel lain: `QWEN_NUM_CTX` (default 8192), `QWEN_THINK` (`true`/`false`, kosong = default model), `QWEN_TIMEOUT_MS` (default 120000), `QWEN_MAX_TOOL_TURNS` (default 6), `QWEN_MAX_TOOL_CHARS` (default 12000). Model 4B lebih lemah dalam memilih tool: mulai dari pertanyaan spesifik, satu device, dan filter yang sempit.

Jika client MCP Anda memakai format `mcpServers` (Claude Desktop, opencode, dsb.):

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["D:/riset/mcp-ai/src/server.mjs"],
      "env": {
        "MIKROTIK_CONFIG": "D:/riset/mcp-ai/mikrotik.config.json",
        "ROS_CORE_PASS": "<password-core>"
      }
    }
  }
}
```

## Tool yang Tersedia

Semua tool menerima `device` opsional.

| Tool | Endpoint RouterOS | Parameter |
|---|---|---|
| `system_info` | `/system/identity`, `/system/resource` | – |
| `list_devices` | config lokal | – |
| `list_interfaces` | `/interface` | `name?`, `runningOnly?`, `limit?`, `offset?` |
| `get_routes` | `/ip/route`, `/ipv6/route` | `family?`, `type?`, `dst?`, `limit?`, `offset?` |
| `get_firewall_rules` | `/ip/firewall/{filter,nat,mangle,address-list}` | `table?`, `chain?`, `limit?`, `offset?` |
| `get_dhcp_leases` | `/ip/dhcp-server/lease` | `status?`, `search?`, `limit?`, `offset?` |
| `get_dns_config` | `/ip/dns`, `/ip/dns/static` | `includeStatic?`, `limit?`, `offset?` |
| `get_wireless_clients` | `/interface/wifi/registration-table`, fallback legacy | `interface?`, `limit?`, `offset?` |
| `get_logs` | `/log` | `topics?[]`, `limit?`, `offset?` |
| `ping` | `POST /rest/ping` | `address`, `count?` (1–10) |

Catatan:

- Batas default output adalah `maxRows` (200), kecuali `get_logs` (50); maksimum `limit` 500 per panggilan. Jika `truncated: true`, persempit filter atau gunakan `offset`.
- `get_firewall_rules` mempertahankan urutan rule router (penting untuk firewall).
- `get_wireless_clients` otomatis memakai menu `wifi` (wifi-qcom) atau `wireless` (paket legacy) di v7.
- Log dikembalikan sesuai urutan router; gunakan `topics` untuk menyaring.
- Semua output JSON menyertakan `summary`, nama `device`, dan metadata pagination.

## Keamanan

- **Read-only berlapis**: client hanya mengizinkan GET; satu-satunya POST adalah `/rest/ping` yang efeknya read-only. User RouterOS juga read-only.
- **Tanpa shell/console bebas**: tidak ada tool yang menerima perintah RouterOS arbitrer.
- **Kredensial**: hanya dari env, tidak enumerable di config, tidak pernah masuk pesan error/log.
- **Redaksi**: field sensitif dan pola `password=...` pada log disamarkan sebelum dikirim ke model.
- **TLS**: verifikasi aktif default; `insecure: true` harus dipilih sadar untuk lab.
- **Rate limit**: `minIntervalMs` per device + timeout.
- **Least privilege**: jangan pakai user `admin`; batasi firewall port 443.

## Batasan v1

- Read-only. Belum ada perubahan konfigurasi.
- REST API tidak mendukung command kontinu (monitor realtime); gunakan data counter/`once`.
- IPv6 baru tersedia untuk route; firewall/DHCP/DNS masih IPv4.
- Tidak ada audit log persisten.
- REST API RouterOS membatasi request sekitar 60 detik; `timeoutMs` default 10 detik.

## Roadmap Write Mode

Urutan aman yang direncanakan:

1. `plan_change` — AI menyusun perubahan + diff, tanpa eksekusi.
2. `dry_run` — validasi parameter dan tampilkan dampak.
3. `apply_change` — eksekusi hanya dengan **confirmation token** one-time (TTL 60 detik).
4. Backup otomatis sebelum write + `rollback`.
5. Audit log, allowlist path/menu, dan approval eksplisit dari aplikasi AI.

## Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| HTTP 401 | User/password salah | Periksa `user` dan env password. |
| HTTP 403 | Policy kurang | Beri policy `read,api,rest-api`; `test` untuk ping. |
| HTTP 404 | Menu tidak ada di versi/instalasi | Cek versi RouterOS dan paket (wifi vs wireless). |
| `connection refused` | `www-ssl` mati / port salah | Aktifkan service dan cek `port`. |
| `TLS certificate ... not trusted` | Sertifikat self-signed | Import CA router ke trust store host, atau `insecure: true` untuk lab. |
| `MCP error -32000: Connection closed` | Server gagal start | Jalankan `npm start` manual dan baca pesan di stderr (biasanya config/password). |
| Output `truncated: true` | Data melebihi limit | Gunakan filter/`limit`/`offset`. |
| `timed out` | Router lambat/request besar | Naikkan `timeoutMs`, persempit query, cek koneksi LAN. |

## Struktur Proyek

```
src/
  server.mjs                  # entry point stdio MCP
  config.mjs                  # loader + validasi config/env
  routeros/
    client.mjs                # REST client read-only, TLS, timeout, cache
    errors.mjs                # pesan error yang aman dan actionable
  tools/                      # satu modul per kelompok tool
  lib/                        # redact, truncate, normalize, result
examples/
  mcp-client-demo.mjs         # smoke test via MCP client
  openai-bridge.mjs           # MCP tools -> OpenAI function calling
test/                         # node:test + mock RouterOS HTTP server
```

Tidak ada dependency runtime tambahan di luar `@modelcontextprotocol/sdk` dan `zod`.
# mcp-ai-networking
