# Outbox Project 1x — project notes

## Outbox Chat
A Discord-style realtime chat app. Rust backend (`src/`), zero-build vanilla frontend (`web/`), run with `cargo run` on port 3000. Details in `README.md`.

## Conventions / user preferences
- **No technical documentation or tech-stack wording in anything shown to users.** UI copy must be plain, product-oriented Thai (no framework names, file names, API names, or roadmap references). Confirmed by the user with a login-screen screenshot on 2026-11-14.
- Do not present technical documents (e.g. `README.md`) as result cards, and keep update replies non-technical. The README stays in the repo for development, but is not displayed.
- Prefer keeping seeded demo content friendly and neutral: `general`, `team-chat`, `random`, `Lounge`.
- Verify UI changes in a real browser before reporting done; clear test accounts from the database before handoff.
- Current source layout: `src/main.rs`, `src/model.rs`, `src/state.rs`, `src/error.rs`, `src/ws.rs`, and `src/handlers/` (module dir: mod/auth/servers/channels/messages/voice) — do not recreate `src/handlers.rs`.
- UX bar is set high: the user compares detail level against Discord (hover states, reactions, replies, popouts, search, status, empty states, keyboard shortcuts). Prefer functional detail over decorative changes.

## กฎการทำงาน (Working Rules)
- **ขนาดไฟล์และโครงสร้างโมดูล**: ทุกไฟล์โค้ดต้องยาว **ไม่เกิน 300 บรรทัด** แยกไฟล์และโฟลเดอร์ตามหน้าที่อย่างชัดเจน (เช่น `src/model/`, `src/crypto/`, `worker/`, `web/js/`, `web/css/`) และต้องมีคอมเมนต์/docstring อธิบายหน้าที่ของไฟล์และฟังก์ชันสำคัญ (ดูรายละเอียดใน `AGENTS.md`)
- **โครงสร้างและการทดสอบ**: จัดไฟล์แยกโมดูลตามหน้าที่ ใช้ภาษาไทยเข้าใจง่ายไม่แสดงศัพท์เทคนิคบน UI, ไม่ใช้ emote/emoji ในงาน, และต้องผ่าน `cargo test` + E2E tests เสมอ
- **ความสมบูรณ์และข้อมูลเริ่มต้น**: ทุกปุ่มและเมนูต้องทำงานได้จริงแบบเรียลไทม์ ทั้งฝั่ง Rust และ Cloudflare Workers และรีเซ็ตข้อมูลเหลือเฉพาะ seed เริ่มต้น (`Outbox HQ`) ก่อนส่งมอบ
