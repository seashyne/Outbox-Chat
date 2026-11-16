# Outbox Project 1x — กฎการทำงานและการจัดโครงสร้างโปรเจกต์

## 1. กฎขนาดไฟล์และโครงสร้างโมดูล (File Size & Modular Structure)
- **ห้ามไฟล์โค้ดยาวเกิน 300 บรรทัด**: ทุกไฟล์ source code ใน `src/`, `worker/`, `web/` และ `tests/` ต้องมีจำนวนบรรทัด **ไม่เกิน 300 บรรทัดต่อไฟล์** (แนะนำให้อยู่ในช่วง 100–250 บรรทัด)
- **แยกโมดูลตามหน้าที่ (Single Responsibility)**: เมื่อไฟล์เริ่มยาวใกล้ 250–300 บรรทัด ให้แตกออกเป็นโมดูลย่อยที่มีหน้าที่ชัดเจน เช่น:
  - `src/`: แยก `model/` (`mod.rs`, `store.rs`, `payloads.rs`), `crypto/` (`mod.rs`, `sha256.rs`, `tests.rs`), `handlers/` (`mod.rs`, `auth.rs`, `users.rs`, `servers.rs`, `channels.rs`, `messages.rs`, `voice.rs`)
  - `worker/`: แยก `index.js`, `hub.js`, `utils.js`, `crypto.js`, `seed.js`, `handlers_*.js`
  - `web/`: แยก ES modules ใน `web/js/` และ stylesheets ใน `web/css/` โดยไม่มี build step
- **ห้ามนำไฟล์ที่แตกแล้วกลับมารวมเป็นไฟล์เดียวขนาดใหญ่**

## 2. คอมเมนต์และเอกสารประกอบโค้ด (Comments & Docstrings)
- **Header comment ทุกไฟล์**: ระบุหน้าที่ความรับผิดชอบหลักของไฟล์และขอบเขตของโมดูลไว้ด้านบน
- **Docstring / JSDoc สำหรับฟังก์ชันและโครงสร้างหลัก**: อธิบาย input, output และพฤติกรรมสำคัญของ struct, class และฟังก์ชันสาธารณะ
- **Inline comment เฉพาะส่วนที่สำคัญ**: อธิบาย *เหตุผล (why)*, ข้อจำกัดด้านความปลอดภัย, หรือ invariant ของระบบให้ชัดเจนและกระชับ

## 3. กฎคุณภาพและการสื่อสารของแอป (Product & Quality Rules)
- **No Emoji / Emote**: ห้ามใช้ emoji หรือ emote ใน UI, ชื่อช่อง, branding, seed data และ reaction tokens (ใช้ SVG icons และข้อความมาตรฐานแทน)
- **UI ภาษาไทยเข้าใจง่าย**: ไม่แสดงศัพท์เทคนิค ชื่อ framework หรือชื่อไฟล์ในหน้าจอที่ผู้ใช้เห็น
- **Dual-Backend Parity**: ฟีเจอร์หลัก (Auth, Settings, Theme, Menus, WebSocket events) ต้องทำงานตรงกันทั้งฝั่ง Rust (`src/`) และ Cloudflare Workers (`worker/`)
- **การตรวจสอบก่อนส่งมอบ**: ต้องผ่าน `cargo test`, `cargo clippy --all-targets`, syntax check ของ JS, และชุดทดสอบ E2E (`tests/run-all.js`) รวมถึงตรวจสอบบนเบราว์เซอร์จริง
