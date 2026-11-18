/**
 * Server starter templates, role metadata helpers, and HTML form builders
 * for the Create Server and Server Settings / Role Management dialogs.
 */

import { t } from './i18n.js';
import { AVATAR_COLORS, escapeHtml, normalizeHex6, safeColor } from './state.js';

export const DEFAULT_ROLES_CONFIG = {
  owner_label: 'เจ้าของเซิร์ฟเวอร์',
  admin_label: 'ผู้ดูแลระบบ',
  member_label: 'สมาชิก',
  admin_color: '#f59e0b',
  member_color: '#94a3b8',
  allow_member_create_channel: true,
};

const DEFAULT_ROLE_KEYS = {
  owner: ['เจ้าของเซิร์ฟเวอร์', 'Owner'],
  admin: ['ผู้ดูแลระบบ', 'Admin'],
  member: ['สมาชิก', 'Member'],
};

/** Returns localized starter server templates for the active UI language. */
export function getServerTemplates() {
  return [
    {
      key: 'blank',
      name: t('tpl.blankName'),
      summary: t('tpl.blankSummary'),
      defaultName: t('tpl.blankDefault'),
      icon: 'OB',
      accent_color: '#5865f2',
      description: t('tpl.blankDesc'),
      admin_label: t('role.admin'),
      member_label: t('role.member'),
      channels: ['#general'],
    },
    {
      key: 'team',
      name: t('tpl.teamName'),
      summary: t('tpl.teamSummary'),
      defaultName: t('tpl.teamDefault'),
      icon: 'TM',
      accent_color: '#23a559',
      description: t('tpl.teamDesc'),
      admin_label: t('tpl.teamAdmin'),
      member_label: t('tpl.teamMember'),
      channels: ['#general', '#announcements', '#tasks', '#standup', 'Meeting Room'],
    },
    {
      key: 'community',
      name: t('tpl.commName'),
      summary: t('tpl.commSummary'),
      defaultName: t('tpl.commDefault'),
      icon: 'CM',
      accent_color: '#eb459e',
      description: t('tpl.commDesc'),
      admin_label: t('tpl.commAdmin'),
      member_label: t('role.member'),
      channels: ['#general', '#welcome', '#showcase', '#off-topic', 'Lounge'],
    },
    {
      key: 'study',
      name: t('tpl.studyName'),
      summary: t('tpl.studySummary'),
      defaultName: t('tpl.studyDefault'),
      icon: 'ST',
      accent_color: '#38bdf8',
      description: t('tpl.studyDesc'),
      admin_label: t('tpl.studyAdmin'),
      member_label: t('tpl.studyMember'),
      channels: ['#general', '#notes', '#q-and-a', 'Study Room'],
    },
  ];
}

/** Resolves a member's effective role key (`owner` | `admin` | `member`) inside `server`. */
export function memberRoleFor(server, userId) {
  if (!server || !userId) return 'member';
  if (server.owner_id === userId) return 'owner';
  return server.member_roles?.[userId] || 'member';
}

function localizedDefaultRole(rawLabel, roleKey) {
  if (!rawLabel || DEFAULT_ROLE_KEYS[roleKey]?.includes(rawLabel)) {
    return t(`role.${roleKey}`);
  }
  return rawLabel;
}

/** Returns localized display label and badge color for `roleKey` in `server`. */
export function roleMeta(server, roleKey) {
  const cfg = { ...DEFAULT_ROLES_CONFIG, ...(server?.roles_config || {}) };
  if (roleKey === 'owner') return { label: localizedDefaultRole(cfg.owner_label, 'owner'), color: '#f59e0b' };
  if (roleKey === 'admin') return { label: localizedDefaultRole(cfg.admin_label, 'admin'), color: safeColor(cfg.admin_color, '#f59e0b') };
  return { label: localizedDefaultRole(cfg.member_label, 'member'), color: safeColor(cfg.member_color, '#94a3b8') };
}

/** Builds starter template cards HTML for server creation. */
export function buildTemplateGridHtml(selectedKey = 'blank') {
  return `
    <div class="srv-section">
      <div class="srv-section-head">${escapeHtml(t('srv.chooseTpl'))}</div>
      <div class="template-grid" id="templateGrid">
        ${getServerTemplates().map((tpl) => `
          <button type="button" class="template-card ${tpl.key === selectedKey ? 'active' : ''}" data-template="${tpl.key}">
            <div class="tpl-top">
              <span class="tpl-badge" style="background:${tpl.accent_color}">${escapeHtml(tpl.icon)}</span>
              <b>${escapeHtml(tpl.name)}</b>
            </div>
            <p class="tpl-desc">${escapeHtml(tpl.summary)}</p>
            <div class="tpl-chips">${tpl.channels.map((ch) => `<span>${escapeHtml(ch)}</span>`).join('')}</div>
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
        <label for="srv_name">${escapeHtml(t('srv.nameLabel'))}</label>
        <input id="srv_name" maxlength="48" value="${escapeHtml(values.name || '')}" placeholder="${escapeHtml(t('srv.namePh'))}" ${ro} />
      </div>
      <div>
        <label for="srv_icon">${escapeHtml(t('srv.iconLabel'))}</label>
        <input id="srv_icon" maxlength="4" value="${escapeHtml(values.icon || '')}" placeholder="HQ" ${ro} />
      </div>
    </div>
    <label for="srv_desc">${escapeHtml(t('srv.descLabel'))}</label>
    <input id="srv_desc" maxlength="180" value="${escapeHtml(values.description || '')}" placeholder="${escapeHtml(t('srv.descPh'))}" ${ro} />
    <label>${escapeHtml(t('srv.accentLabel'))}</label>
    <div class="srv-color-row">
      <div class="color-swatches" id="srvColorSwatches">
        ${AVATAR_COLORS.map((c) => `
          <button type="button" class="color-swatch ${c.toLowerCase() === accent ? 'active' : ''}"
                  data-srv-color="${c}" style="background:${c}" aria-label="${escapeHtml(t('srv.pickColor', { color: c }))}" ${ro}></button>`).join('')}
      </div>
      <input type="color" id="srv_accent" value="${accent}" aria-label="${escapeHtml(t('srv.accentLabel'))}" ${ro} />
    </div>
    <div class="srv-role-box">
      <div class="srv-section-head">${escapeHtml(t('srv.rolesHead'))}</div>
      <div class="srv-role-grid">
        <div class="srv-role-item">
          <label for="srv_admin_label">${escapeHtml(t('srv.adminLabel'))}</label>
          <div class="srv-role-inputs">
            <input id="srv_admin_label" maxlength="24" value="${escapeHtml(values.admin_label || t('role.admin'))}" ${ro} />
            <input type="color" id="srv_admin_color" value="${adminColor}" aria-label="${escapeHtml(t('srv.adminLabel'))}" ${ro} />
          </div>
        </div>
        <div class="srv-role-item">
          <label for="srv_member_label">${escapeHtml(t('srv.memberLabel'))}</label>
          <div class="srv-role-inputs">
            <input id="srv_member_label" maxlength="24" value="${escapeHtml(values.member_label || t('role.member'))}" ${ro} />
            <input type="color" id="srv_member_color" value="${memberColor}" aria-label="${escapeHtml(t('srv.memberLabel'))}" ${ro} />
          </div>
        </div>
      </div>
      <label class="srv-check-row">
        <input type="checkbox" id="srv_allow_channel" ${values.allow_member_create_channel !== false ? 'checked' : ''} ${ro} />
        <span>${escapeHtml(t('srv.allowCreateChannel'))}</span>
      </label>
    </div>`;
}
