/**
 * Initial seeded store for Outbox Chat (`Outbox HQ` demo server).
 * Kept free of decorative emojis/emotes.
 */

import { defaultSettings, newToken, nowIso } from "./utils.js";

/** Builds a fresh seeded database object on first Durable Object initialization. */
export function seededStore() {
  const created = nowIso();
  const bot = {
    id: "outbox-bot",
    username: "outbox-bot",
    display_name: "Outbox Bot",
    color: "#5865f2",
    token: newToken(),
    bot: true,
    created_at: created,
    password_hash: "",
    password_salt: "",
    settings: defaultSettings(),
  };

  const server = {
    id: "demo",
    name: "Outbox HQ",
    icon: "HQ",
    owner_id: bot.id,
    created_at: created,
  };

  const channelSpecs = [
    ["general", "text", "ยินดีต้อนรับ! ที่นี่คือห้องคุยรวมของ Outbox HQ"],
    ["team-chat", "text", "คุยเรื่องงาน ไอเดียใหม่ ๆ หรืออะไรก็ได้"],
    ["random", "text", "แชร์เรื่องสนุก ๆ ได้ตามสบาย"],
    ["Lounge", "voice", "ห้องเสียงสำหรับนั่งคุยกัน"],
  ];

  const channels = {};
  channelSpecs.forEach(([name, kind, topic], index) => {
    const id = `demo-${index}`;
    channels[id] = {
      id,
      server_id: server.id,
      name,
      kind,
      topic,
      position: index,
      created_at: nowIso(),
    };
  });

  const greetings = [
    "ยินดีต้อนรับสู่ **Outbox Chat** มารู้จักกันและคุยกันได้เลยนะ",
    "ลองเปิดอีกหน้าต่าง ใช้ชื่ออื่น แล้วพิมพ์ข้อความดูสิ — เพื่อนจะเห็นทันที",
    "สร้างเซิร์ฟเวอร์หรือช่องใหม่ได้จากปุ่ม + ด้านซ้าย หรือกดห้องเสียงเพื่อดูว่าใครอยู่บ้าง",
  ];

  const messages = {
    "demo-0": greetings.map((content, index) => ({
      id: `seed-${index}`,
      channel_id: "demo-0",
      author_id: bot.id,
      content,
      created_at: nowIso(),
      edited_at: null,
      reply_to: null,
      reactions: {},
    })),
  };

  return {
    users: { [bot.id]: bot },
    tokens: { [bot.token]: bot.id },
    servers: { [server.id]: server },
    channels,
    messages,
    members: { [server.id]: { [bot.id]: "owner" } },
  };
}
