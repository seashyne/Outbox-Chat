/**
 * Starter server templates, role-configuration defaults, and validation helpers
 * matching the Rust backend behavior 1:1.
 */

import { HttpError, cleanText, isValidHexColor, newId, nowIso } from "./utils.js";

/** Returns default server role labels, badge colors, and member permissions. */
export function defaultRolesConfig() {
  return {
    owner_label: "เจ้าของเซิร์ฟเวอร์",
    admin_label: "ผู้ดูแลระบบ",
    member_label: "สมาชิก",
    admin_color: "#f59e0b",
    member_color: "#94a3b8",
    allow_member_create_channel: true,
  };
}

/** Backfills missing server metadata fields on legacy stored server objects. */
export function normalizeServerFields(server) {
  let changed = false;
  if (typeof server.description !== "string") { server.description = ""; changed = true; }
  if (typeof server.accent_color !== "string" || !isValidHexColor(server.accent_color)) {
    server.accent_color = "#5865f2";
    changed = true;
  }
  const base = defaultRolesConfig();
  if (!server.roles_config || typeof server.roles_config !== "object") {
    server.roles_config = base;
    changed = true;
  } else {
    for (const [k, v] of Object.entries(base)) {
      if (server.roles_config[k] === undefined) {
        server.roles_config[k] = v;
        changed = true;
      }
    }
  }
  return changed;
}

const TEMPLATES = {
  blank: {
    description: "",
    accent_color: "#5865f2",
    admin_label: "ผู้ดูแลระบบ",
    member_label: "สมาชิก",
    channels: [["general", "text", "ช่องทั่วไป"]],
  },
  team: {
    description: "พื้นที่ทำงานร่วมกันสำหรับทีมและโปรเจกต์",
    accent_color: "#23a559",
    admin_label: "หัวหน้าทีม",
    member_label: "สมาชิกทีม",
    channels: [
      ["general", "text", "พื้นที่สื่อสารหลักของทีม"],
      ["announcements", "text", "ประกาศและข่าวสารสำคัญ"],
      ["tasks", "text", "ติดตามงานและสิ่งที่ต้องทำ"],
      ["standup", "text", "อัปเดตงานประจำวัน"],
      ["Meeting Room", "voice", "ห้องประชุมเสียงของทีม"],
    ],
  },
  community: {
    description: "คอมมูนิตี้สำหรับพูดคุยและแลกเปลี่ยนเรื่องที่สนใจ",
    accent_color: "#eb459e",
    admin_label: "ผู้ดูแลชุมชน",
    member_label: "สมาชิก",
    channels: [
      ["general", "text", "คุยเล่นและทักทาย"],
      ["welcome", "text", "แนะนำตัวและกติกาชุมชน"],
      ["showcase", "text", "แชร์ผลงานและไอเดีย"],
      ["off-topic", "text", "เรื่องทั่วไปนอกเหนือจากหัวข้อหลัก"],
      ["Lounge", "voice", "ห้องเสียงสำหรับนั่งคุยกัน"],
      ["Music Room", "voice", "ห้องฟังเพลงและพักผ่อน"],
    ],
  },
  study: {
    description: "พื้นที่ติวหนังสือ สรุปบทเรียน และถาม-ตอบ",
    accent_color: "#38bdf8",
    admin_label: "ติวเตอร์",
    member_label: "ผู้เรียน",
    channels: [
      ["general", "text", "พูดคุยทั่วไป"],
      ["notes", "text", "สรุปบทเรียนและเอกสาร"],
      ["q-and-a", "text", "ถาม-ตอบข้อสงสัย"],
      ["Study Room", "voice", "ห้องติวหนังสือและทำงานกลุ่ม"],
    ],
  },
};

/** Resolves a template spec by key or throws HTTP 400 on unknown template names. */
export function resolveTemplate(raw) {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    throw new HttpError(400, "template must be a string");
  }
  const key = typeof raw === "string" && raw.trim() ? raw.trim() : "blank";
  const spec = TEMPLATES[key];
  if (!spec) {
    throw new HttpError(400, "template must be one of: blank, team, community, study");
  }
  return spec;
}

/** Validates optional short text allowing empty string to clear fields. */
export function cleanOptionalText(raw, max, what) {
  if (typeof raw !== "string") throw new HttpError(400, `${what} must be 0-${max} characters`);
  if (/[\x00-\x1F\x7F]/.test(raw)) throw new HttpError(400, `${what} cannot contain control characters`);
  const trimmed = raw.trim();
  if ([...trimmed].length > max) throw new HttpError(400, `${what} must be 0-${max} characters`);
  return trimmed;
}

/** Validates hex color input and throws HTTP 400 on malformed values. */
export function validateColor(raw, what) {
  if (typeof raw !== "string" || !isValidHexColor(raw)) {
    throw new HttpError(400, `${what} must be a valid hex color`);
  }
  return raw.trim();
}

/** Validates and applies partial updates to a server's role configuration. */
export function applyRolesPatch(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new HttpError(400, "roles_config must be an object");
  }
  for (const key of ["owner_label", "admin_label", "member_label"]) {
    if (patch[key] !== undefined) target[key] = cleanText(patch[key], 24, key);
  }
  for (const key of ["admin_color", "member_color"]) {
    if (patch[key] !== undefined) target[key] = validateColor(patch[key], key);
  }
  if (patch.allow_member_create_channel !== undefined) {
    if (typeof patch.allow_member_create_channel !== "boolean") {
      throw new HttpError(400, "allow_member_create_channel must be boolean");
    }
    target.allow_member_create_channel = patch.allow_member_create_channel;
  }
}

/** Builds ordered starter channels for `serverId` from `spec`. */
export function buildTemplateChannels(serverId, spec) {
  const ts = nowIso();
  let textPos = 0;
  let voicePos = 0;
  return spec.channels.map(([name, kind, topic]) => {
    const position = kind === "voice" ? voicePos++ : textPos++;
    return {
      id: newId(),
      server_id: serverId,
      name,
      kind,
      topic,
      category: null,
      visibility: "public",
      read_only: false,
      slowmode_seconds: 0,
      position,
      created_at: ts,
    };
  });
}
