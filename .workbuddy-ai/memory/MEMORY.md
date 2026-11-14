# Outbox Project 1x — project notes

## Outbox Chat
A Discord-style realtime chat app. Rust backend (`src/`), zero-build vanilla frontend (`web/`), run with `cargo run` on port 3000. Details in `README.md`.

## Conventions / user preferences
- **No technical documentation or tech-stack wording in anything shown to users.** UI copy must be plain, product-oriented Thai (no framework names, file names, API names, or roadmap references). Confirmed by the user with a login-screen screenshot on 2026-11-14.
- Do not present technical documents (e.g. `README.md`) as result cards, and keep update replies non-technical. The README stays in the repo for development, but is not displayed.
- Prefer keeping seeded demo content friendly and neutral: `general`, `team-chat`, `random`, `Lounge`.
- Verify UI changes in a real browser before reporting done; clear test accounts from the database before handoff.

## กฎการทำงาน (Working Rules)
- **ภาษาและข้อความบนหน้าจอ (UI Copy)**: ใช้ภาษาไทยที่เข้าใจง่ายสำหรับผู้ใช้งานจริง ห้ามแสดงศัพท์เทคนิค ชื่อเฟรมเวิร์ก ชื่อไลบรารี ชื่อไฟล์ หรือเอกสารทางเทคนิคบน UI
- **การจัดโครงสร้างโค้ด (Modular Structure)**: แยกไฟล์ตามหน้าที่และหมวดหมู่ฟีเจอร์อย่างชัดเจน (`src/handlers/{auth,servers,channels,messages,voice}.rs`, `src/model.rs`, `src/state.rs`, `src/ws.rs`, `web/*`)
- **ความสมบูรณ์ของปุ่มและฟีเจอร์ (Interactive Actions)**: ทุกปุ่มบนหน้าจอต้องกดใช้งานได้จริงและอัปเดตสถานะแบบเรียลไทม์
- **การตรวจสอบและข้อมูลเริ่มต้น (Verification & Clean Seed)**: ทดสอบด้วย `cargo test` ทุกครั้งหลังแก้ไข และรีเซ็ตข้อมูลทดสอบออกให้เหลือเฉพาะข้อมูลเริ่มต้น (`Outbox HQ`) ก่อนส่งมอบหรืออัปโหลดขึ้น GitHub
