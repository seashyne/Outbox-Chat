/**
 * Server starter templates, role metadata helpers, and HTML form builders
 * for the Create Server and Server Settings / Role Management dialogs.
 */

import { AVATAR_COLORS, escapeHtml, normalizeHex6, safeColor } from './state.js';

export const DEFAULT_ROLES_CONFIG = {
  owner_label: 'เจ้าของเซิร์ฟเวอร์',
  admin_label: 'ผู้ดูแลระบบ',
  member_label: 'สมาชิก',
  admin_color: '#f59e0b',
  member_color: '#94a3b8',
  allow_member_create_channel: true,
};

export const SERVER_TEMPLATES = [
  {
    key: 'blank',
    name: 'เซิร์ฟเวอร์เริ่มต้น',
    summary: 'โครงสร้างเรียบง่าย มีห้องพูดคุยหลัก 1 ห้อง',
    defaultName: 'พื้นที่ของฉัน',
    icon: 'OB',
    accent_color: '#5865f2',
    description: 'พื้นที่พูดคุยสำหรับทีมและเพื่อน',
    admin_label: 'ผู้ดูแลระบบ',
    member_label: 'สมาชิก',
    channels: ['#general'],
  },
  {
    key: 'team',
    name: 'ทีมทำงานและโปรเจกต์',
    summary: 'พร้อมห้องประกาศ ติดตามงาน ประชุมเสียง และอัปเดตงาน',
    defaultName: 'ทีมโปรเจกต์',
    icon: 'TM',
    accent_color: '#23a559',
    description: 'พื้นที่ทำงานร่วมกันสำหรับทีมและโปรเจกต์',
    admin_label: 'หัวหน้าทีม',
    member_label: 'สมาชิกทีม',
    channels: ['#general', '#announcements', '#tasks', '#standup', 'Meeting Room'],
  },
  {
    key: 'community',
    name: 'คอมมูนิตี้ / ชมรม',
    summary: 'มีห้องต้อนรับ แชร์ผลงาน คุยเล่น และห้องเสียง 2 ห้อง',
    defaultName: 'คลับคอมมูนิตี้',
    icon: 'CM',
    accent_color: '#eb459e',
    description: 'คอมมูนิตี้สำหรับพูดคุยและแลกเปลี่ยนเรื่องที่สนใจ',
    admin_label: 'ผู้ดูแลชุมชน',
    member_label: 'สมาชิก',
    channels: ['#general', '#welcome', '#showcase', '#off-topic', 'Lounge'],
  },
  {
    key: 'study',
    name: 'กลุ่มเรียน / ติวหนังสือ',
    summary: 'มีห้องสรุปบทเรียน ถาม-ตอบ และห้องเสียงติวร่วมกัน',
    defaultName: 'ห้องติวออนไลน์',
    icon: 'ST',
    accent_color: '#38bdf8',
    description: 'พื้นที่ติวหนังสือ สรุปบทเรียน และถาม-ตอบ',
    admin_label: 'ติวเตอร์',
    member_label: 'ผู้เรียน',
    channels: ['#general', '#notes', '#q-and-a', 'Study Room'],
  },
];

/** Resolves a member's effective role key (`owner` | `admin` | `member`) inside `server`. */
export function memberRoleFor(server, userId) {
  if (!server || !userId) return 'member';
  if (server.owner_id === userId) return 'owner';
  return server.member_roles?.[userId] || 'member';
}

/** Returns localized display label and badge color for `roleKey` in `server`. */
export function roleMeta(server, roleKey) {
  const cfg = { ...DEFAULT_ROLES_CONFIG, ...(server?.roles_config || {}) };
  if (roleKey === 'owner') return { label: cfg.owner_label || 'เจ้าของเซิร์ฟเวอร์', color: '#f59e0b' };
  if (roleKey === 'admin') return { label: cfg.admin_label || 'ผู้ดูแลระบบ', color: safeColor(cfg.admin_color, '#f59e0b') };
  return { label: cfg.member_label || 'สมาชิก', color: safeColor(cfg.member_color, '#94a3b8') };
}

/** Builds starter template cards HTML for server creation. */
export function buildTemplateGridHtml(selectedKey = 'blank') {
  return `
    <div class="srv-section">
      <div class="srv-section-head">เลือกตัวอย่างเซิร์ฟเวอร์ (Template)</div>
      <div class="template-grid" id="templateGrid">
        ${SERVER_TEMPLATES.map((t) => `
          <button type="button" class="template-card ${t.key === selectedKey ? 'active' : ''}" data-template="${t.key}">
            <div class="tpl-top">
              <span class="tpl-badge" style="background:${t.accent_color}">${escapeHtml(t.icon)}</span>
              <b>${escapeHtml(t.name)}</b>
            </div>
            <p class="tpl-desc">${escapeHtml(t.summary)}</p>
            <div class="tpl-chips">${t.channels.map((ch) => `<span>${escapeHtml(ch)}</span>`).join('')}</div>
          </button>`).join('')}
      </div>
    </div>`;
}

/** Builds core server metadata + role customization inputs shared by create & edit dialogs. */
export function buildServerFieldsHtml(values, disabled = false) {
  const ro = disabled ? 'disabled' : '';
  const accent = normalizeHex6(values.accent_color, '#5865f2');
  const adminColor = normalizeHex6(values.admin_color, '#f59e0b');
  const memberColor = normalizeHex6(values.member_color, '#94a3b8');
  return `
    <div class="srv-two-col">
      <div>
        <label for="srv_name">ชื่อเซิร์ฟเวอร์</label>
        <input id="srv_name" maxlength="48" value="${escapeHtml(values.name || '')}" placeholder="เช่น ทีมออกแบบ" ${ro} />
      </div>
      <div>
        <label for="srv_icon">ตัวย่อ (สูงสุด 4 ตัวอักษร)</label>
        <input id="srv_icon" maxlength="4" value="${escapeHtml(values.icon || '')}" placeholder="HQ" ${ro} />
      </div>
    </div>
    <label for="srv_desc">คำอธิบายเซิร์ฟเวอร์</label>
    <input id="srv_desc" maxlength="180" value="${escapeHtml(values.description || '')}" placeholder="บอกเป้าหมายหรือกติกาคร่าว ๆ ของเซิร์ฟเวอร์" ${ro} />
    <label>สีประจำเซิร์ฟเวอร์</label>
    <div class="srv-color-row">
      <div class="color-swatches" id="srvColorSwatches">
        ${AVATAR_COLORS.map((c) => `
          <button type="button" class="color-swatch ${c.toLowerCase() === accent ? 'active' : ''}"
                  data-srv-color="${c}" style="background:${c}" aria-label="เลือกสี ${c}" ${ro}></button>`).join('')}
      </div>
      <input type="color" id="srv_accent" value="${accent}" aria-label="เลือกสีประจำเซิร์ฟเวอร์" ${ro} />
    </div>
    <div class="srv-role-box">
      <div class="srv-section-head">ปรับแต่งบทบาทเริ่มต้นและสิทธิ์ (Role)</div>
      <div class="srv-role-grid">
        <div class="srv-role-item">
          <label for="srv_admin_label">ชื่อบทบาทผู้ดูแล</label>
          <div class="srv-role-inputs">
            <input id="srv_admin_label" maxlength="24" value="${escapeHtml(values.admin_label || 'ผู้ดูแลระบบ')}" ${ro} />
            <input type="color" id="srv_admin_color" value="${adminColor}" aria-label="สีบทบาทผู้ดูแล" ${ro} />
          </div>
        </div>
        <div class="srv-role-item">
          <label for="srv_member_label">ชื่อบทบาทสมาชิก</label>
          <div class="srv-role-inputs">
            <input id="srv_member_label" maxlength="24" value="${escapeHtml(values.member_label || 'สมาชิก')}" ${ro} />
            <input type="color" id="srv_member_color" value="${memberColor}" aria-label="สีบทบาทสมาชิก" ${ro} />
          </div>
        </div>
      </div>
      <label class="srv-check-row">
        <input type="checkbox" id="srv_allow_channel" ${values.allow_member_create_channel !== false ? 'checked' : ''} ${ro} />
        <span>อนุญาตให้สมาชิกทั่วไปสร้างช่องสนทนาใหม่ได้</span>
      </label>
    </div>`;
}
