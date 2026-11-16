# Outbox Chat

ระบบแชทแบบ Discord ที่เขียนด้วย **Rust ทั้งสาย** (backend) + HTML/CSS/JS vanilla (frontend)
ทำงานได้จริง ไม่ใช่ mock: หลายคน หลายแท็บ คุยกัน realtime ผ่าน WebSocket

```text
Rust 1.99 · axum 0.8 · tokio 1 · tower-http · serde · UUID · chrono
```

---

## เริ่มใช้งาน

```bash
cd "Outbox Project 1x"
cargo run
```

เปิด <http://localhost:3000> → ใส่ชื่อ → กด **เข้าร่วมเลย**
ลองเปิดอีกเบราว์เซอร์ (หรือ Incognito) ใส่อีกชื่อ แล้วพิมพ์ข้อความดู — จะเห็นแบบ realtime ทันที

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `PORT` | `3000` | พอร์ต HTTP + WebSocket |
| `WEB_DIR` | `web` | โฟลเดอร์ไฟล์ frontend |
| `DATA_PATH` | `data/store.json` | ไฟล์ฐานข้อมูล JSON |

ตัวอย่าง: `PORT=8080 cargo run` (Windows PowerShell: `$env:PORT=8080; cargo run`)

---

## สิ่งที่ทำได้แล้ว

- **Auth แบบเบา** — สมัครด้วยชื่อ รับ bearer token เก็บใน localStorage (ไม่มีรหัสผ่าน เพราะเป็น demo)
- **Servers / Guilds** — สร้างเซิร์ฟเวอร์, ค้นหาเซิร์ฟเวอร์, เข้าร่วม, บทบาท `owner / admin / member`
- **Channels** — ช่องข้อความ (slug อัตโนมัติ) และช่องเสียง แยกกลุ่มใน sidebar
- **Messages** — ส่ง / โหลดประวัติ / ลบ / ตอบกลับพร้อม quote ต้นฉบับ / ปฏิกิริยา (reaction) แบบ toggle / จัดกลุ่มข้อความ / markdown เบา ๆ / ป้องกัน XSS
- **Realtime** — WebSocket gateway: ข้อความใหม่, แก้ไขปฏิกิริยา, ลบ, ช่องใหม่, สมาชิกใหม่, typing indicator, presence online/offline
- **Voice presence** — เข้า/ออกห้องเสียง เห็นรายชื่อคนในห้องแบบ realtime *(signalling อย่างเดียว ยังไม่มีเสียงจริง)*
- **UX** — แบ่งวัน, empty state, toolbar ตอน hover, โปรไฟล์popout, เมนูเซิร์ฟเวอร์/ช่อง/สถานะ, ค้นหาในช่อง, emoji picker, นับตัวอักษร, reply bar, jump-to-present, unread/mention badge, ยุบหมวดหมู่, mic/deafen, reconnect, heartbeat, toast, modal, theme สว่าง/มืด, responsive, คีย์ลัด
- **Persistence** — เขียน `data/store.json` แบบ temp-file + rename (กันไฟล์เสียครึ่งเดียว) รีสตาร์ทแล้วข้อมูลยังอยู่
- **Seed data** — เซิร์ฟเวอร์ `Outbox HQ` + 4 ช่อง + ข้อความต้อนรับ พร้อมใช้งานทันที

---

## สถาปัตยกรรม

```text
Browser ──REST /api/*──────────► axum Router ──► AppState
   │                                 │            ├─ RwLock<Store>      (users/servers/channels/messages/members)
   └──WebSocket /api/ws─────────────┤            ├─ RwLock<online>     (presence)
                                    │            ├─ RwLock<voice>      (ephemeral)
                                    │            ├─ broadcast::Sender  (event fan-out)
                                    │            └─ data/store.json    (atomic persist)
                                    └── ServeDir("web") → index.html / style.css / app.js
```

| ไฟล์ | หน้าที่ |
| --- | --- |
| `src/main.rs` | ประกอบ router, CORS, static files, graceful shutdown |
| `src/model.rs` | domain types, API payloads, `Event` / `ClientEvent`, seed data |
| `src/state.rs` | shared state, presence, voice, broadcast, JSON persistence + unit tests |
| `src/error.rs` | `ApiError` → HTTP status + JSON error |
| `src/handlers/` | REST handlers แยกตามโดเมน (auth/servers/channels/messages/voice) + `Auth` extractor + validation + authorization |
| `src/ws.rs` | WebSocket gateway, membership-filtered fan-out, heartbeat, cleanup |
| `web/*` | Discord-like UI (vanilla, ไม่มี build step) |

**ทำไมใช้ in-memory + JSON แทน SQL?** เพื่อให้โปรเจกต์ไม่มี native dependency (ไม่ต้องลง SQLite/Postgres) แต่โครงสร้าง `Store` ออกแบบให้ย้ายไป SQL ได้ตรง ๆ: `users`, `servers`, `channels`, `messages`, `members` คือตาราง 1:1

---

## REST API

ทุก endpoint (ยกเว้น `/api/health`, `/api/register`) ต้องส่ง `Authorization: Bearer <token>`

| Method | Path | Body / Query | ผลลัพธ์ |
| --- | --- | --- | --- |
| GET | `/api/health` | — | status + สถิติ |
| POST | `/api/register` | `{ "username": "ferris" }` | `{ token, user }` |
| GET | `/api/bootstrap` | — | me + servers + channels + members + online + voice |
| GET | `/api/servers` | — | รายการเซิร์ฟเวอร์ทั้งหมด + `joined` |
| POST | `/api/servers` | `{ "name", "icon"? }` | สร้างเซิร์ฟเวอร์ + ช่อง `#general` |
| POST | `/api/servers/{id}/join` | — | เข้าร่วมเซิร์ฟเวอร์ |
| POST | `/api/servers/{id}/channels` | `{ "name", "kind": "text"\|"voice", "topic"? }` | สร้างช่อง |
| GET | `/api/channels/{id}/messages` | `?limit=60&before=<id>` | ประวัติข้อความ |
| POST | `/api/channels/{id}/messages` | `{ "content", "reply_to"?: "<id>" }` | ส่งข้อความ (ตอบกลับได้) |
| DELETE | `/api/messages/{id}` | — | ลบข้อความ (204) |
| POST | `/api/messages/{id}/reactions` | `{ "emoji": "+1" }` | สลับปฏิกิริยา เปิด/ปิด |
| POST | `/api/channels/{id}/voice/join` | — | เข้าห้องเสียง *(ต้องมี WebSocket ที่เชื่อมต่ออยู่)* |
| POST | `/api/channels/{id}/voice/leave` | — | ออกห้องเสียง |

> ห้องเสียงผูกกับ connection จริง: ถ้า WS หลุด ระบบจะถอดชื่อออกจากทุกห้องอัตโนมัติ จึงไม่มี "คนหลอน" ค้างอยู่

### ตัวอย่าง curl

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/register \
  -H 'Content-Type: application/json' -d '{"username":"ferris"}' | jq -r .token)

curl -s localhost:3000/api/bootstrap -H "Authorization: Bearer $TOKEN" | jq

curl -s -X POST localhost:3000/api/channels/demo-0/messages \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"สวัสดีทุกคน"}' | jq

curl -s -X POST localhost:3000/api/messages/seed-0/reactions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"emoji":"+1"}' | jq
```

### WebSocket

```text
ws://localhost:3000/api/ws?token=<token>
```

Server → client: `ready`, `presence`, `message_create`, `message_update`, `message_delete`, `channel_create`, `server_create`, `member_join`, `typing`, `voice_state`, `heartbeat`, `pong`
Client → server: `{ "type": "typing", "channel_id": "..." }`, `{ "type": "ping" }`

Event ที่มี `server_id` จะถูกกรองให้เฉพาะสมาชิกของเซิร์ฟเวอร์นั้นก่อนส่งออก (`src/ws.rs`)

---

## ทดสอบ

```bash
cargo test     # unit tests: seed data, presence หลายแท็บ, voice single-channel
cargo build --release
```

## ข้อจำกัดที่ตั้งใจไว้ (Roadmap)

| ยังไม่มี | แนวทางต่อยอด |
| --- | --- |
| เสียง/วิดีโอจริง | WebRTC SFU (mediasoup / LiveKit) + signalling ผ่าน WS ที่มีอยู่แล้ว |
| รหัสผ่าน / OAuth | argon2 + JWT + refresh token, ย้าย token ออกจาก JSON store |
| ฐานข้อมูลจริง | sqlx + Postgres (schema ตรงกับ `Store`) + migration |
| ขยายหลายเครื่อง | Redis/NATS pub/sub แทน `tokio::broadcast`, sticky session หรือ gateway แยก |
| อัปโหลดไฟล์ / แนบรูป / สติกเกอร์ | object storage + ตาราง attachments |
| แก้ไขข้อความ, pin, threads | `PATCH /messages/{id}`, ตาราง pinned_messages, `thread_id` |
| Permission ละเอียด, DM, threads, E2EE | role/permission bitfield, direct-message channels, MLS |
| Rate limit, moderation | tower `RateLimitLayer`, word filter, audit log |

> โปรเจกต์นี้เหมาะกับเรียนรู้สถาปัตยกรรม realtime ใน Rust และเป็นฐานต่อยอด **ไม่ควรใช้เป็น production chat** โดยตรง เพราะ auth แบบ demo, ไม่มี TLS/rate limit และ store เป็น JSON ไฟล์เดียว

---

## License

MIT — ทำเพื่อการเรียนรู้และทดลอง
