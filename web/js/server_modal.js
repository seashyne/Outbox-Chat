/**
 * Interactive Create Server dialog (with starter templates & role setup) and
 * Server Settings / Member Role Manager modal.
 */

import { selectServer } from './actions.js';
import { api, toast } from './api.js';
import { openModal } from './modals.js';
import { renderHeader, renderMembers, renderRail, renderSidebar } from './render_shell.js';
import {
  DEFAULT_ROLES_CONFIG,
  SERVER_TEMPLATES,
  buildServerFieldsHtml,
  buildTemplateGridHtml,
  memberRoleFor,
  roleMeta,
} from './server_templates.js';
import { $, avatar, currentServer, escapeHtml, normalizeHex6, state } from './state.js';

function readServerFormPayload() {
  return {
    name: $('srv_name').value.trim(),
    icon: $('srv_icon').value.trim() || undefined,
    description: $('srv_desc').value.trim(),
    accent_color: normalizeHex6($('srv_accent').value, '#5865f2'),
    roles_config: {
      admin_label: $('srv_admin_label').value.trim() || 'ผู้ดูแลระบบ',
      member_label: $('srv_member_label').value.trim() || 'สมาชิก',
      admin_color: normalizeHex6($('srv_admin_color').value, '#f59e0b'),
      member_color: normalizeHex6($('srv_member_color').value, '#94a3b8'),
      allow_member_create_channel: $('srv_allow_channel').checked,
    },
  };
}

function wireColorSwatches() {
  const swatches = $('srvColorSwatches');
  const accentInput = $('srv_accent');
  if (!swatches || !accentInput) return;
  const sync = (hex) => {
    const norm = normalizeHex6(hex, '#5865f2');
    accentInput.value = norm;
    swatches.querySelectorAll('.color-swatch').forEach((b) => {
      b.classList.toggle('active', b.dataset.srvColor?.toLowerCase() === norm);
    });
  };
  swatches.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-srv-color]');
    if (btn && !btn.disabled) sync(btn.dataset.srvColor);
  });
  accentInput.addEventListener('input', (e) => sync(e.target.value));
}

/** Opens the template-enabled Create Server modal with customizable metadata and roles. */
export function openCreateServer() {
  let selectedTemplate = 'blank';
  const starter = SERVER_TEMPLATES[0];
  openModal({
    title: 'สร้างเซิร์ฟเวอร์ใหม่',
    desc: 'เลือกตัวอย่างเริ่มต้นหรือปรับแต่งชื่อ สี และบทบาทสมาชิกได้ทันที',
    submitText: 'สร้างเซิร์ฟเวอร์',
    wide: true,
    html: buildTemplateGridHtml(selectedTemplate) + buildServerFieldsHtml({
      name: '',
      icon: '',
      description: starter.description,
      accent_color: starter.accent_color,
      admin_label: starter.admin_label,
      member_label: starter.member_label,
      allow_member_create_channel: true,
    }),
    onSubmit: async () => {
      const payload = { template: selectedTemplate, ...readServerFormPayload() };
      if (!payload.name) throw new Error('กรุณาใส่ชื่อเซิร์ฟเวอร์');
      const server = await api('/servers', { method: 'POST', body: JSON.stringify(payload) });
      state.servers.push(server);
      await selectServer(server.id);
      toast(`สร้างเซิร์ฟเวอร์ "${server.name}" แล้ว`, 'ok');
    },
  });

  wireColorSwatches();
  $('templateGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-template]');
    if (!card) return;
    const tpl = SERVER_TEMPLATES.find((t) => t.key === card.dataset.template);
    if (!tpl) return;
    selectedTemplate = tpl.key;
    document.querySelectorAll('#templateGrid .template-card').forEach((el) => {
      el.classList.toggle('active', el.dataset.template === tpl.key);
    });
    if (!$('srv_name').value.trim()) $('srv_name').value = tpl.defaultName;
    if (!$('srv_icon').value.trim()) $('srv_icon').value = tpl.icon;
    $('srv_desc').value = tpl.description;
    $('srv_admin_label').value = tpl.admin_label;
    $('srv_member_label').value = tpl.member_label;
    $('srv_accent').value = normalizeHex6(tpl.accent_color);
    $('srvColorSwatches')?.querySelectorAll('.color-swatch').forEach((b) => {
      b.classList.toggle('active', b.dataset.srvColor?.toLowerCase() === tpl.accent_color.toLowerCase());
    });
  });
}

function renderMemberRolesList(server) {
  const isOwner = Boolean(state.me && server.owner_id === state.me.id);
  const cfg = { ...DEFAULT_ROLES_CONFIG, ...(server.roles_config || {}) };
  return (server.members || []).map((m) => {
    const rKey = memberRoleFor(server, m.id);
    const meta = roleMeta(server, rKey);
    const editable = isOwner && m.id !== server.owner_id;
    return `
      <div class="srv-member-row">
        <div class="srv-member-info">
          ${avatar(m, 'sm')}
          <div>
            <b>${escapeHtml(m.display_name)}</b>
            <span>@${escapeHtml(m.username)}</span>
          </div>
        </div>
        ${editable ? `
          <select class="srv-role-select" data-role-user="${escapeHtml(m.id)}" aria-label="เปลี่ยนบทบาทของ ${escapeHtml(m.display_name)}">
            <option value="admin" ${rKey === 'admin' ? 'selected' : ''}>${escapeHtml(cfg.admin_label)}</option>
            <option value="member" ${rKey === 'member' ? 'selected' : ''}>${escapeHtml(cfg.member_label)}</option>
          </select>` : `
          <span class="role-pill" style="--role-color:${meta.color}">${escapeHtml(meta.label)}</span>`}
      </div>`;
  }).join('');
}

/** Opens the Server Settings & Role Manager dialog for the active server. */
export function openServerSettings(initialTab = 'general') {
  const server = currentServer();
  if (!server) return;
  const canManage = ['owner', 'admin'].includes(server.role);
  const cfg = { ...DEFAULT_ROLES_CONFIG, ...(server.roles_config || {}) };

  const html = `
    <div class="settings-tabs" role="tablist">
      <button type="button" class="settings-tab ${initialTab === 'general' ? 'active' : ''}" data-srv-tab="general">ข้อมูลและบทบาท</button>
      <button type="button" class="settings-tab ${initialTab === 'members' ? 'active' : ''}" data-srv-tab="members">สมาชิกและปรับ Role</button>
    </div>
    <div id="srvPaneGeneral" ${initialTab !== 'general' ? 'hidden' : ''}>
      ${buildServerFieldsHtml({
        name: server.name,
        icon: server.icon,
        description: server.description,
        accent_color: server.accent_color,
        admin_label: cfg.admin_label,
        member_label: cfg.member_label,
        admin_color: cfg.admin_color,
        member_color: cfg.member_color,
        allow_member_create_channel: cfg.allow_member_create_channel,
      }, !canManage)}
    </div>
    <div id="srvPaneMembers" class="srv-members-list" ${initialTab !== 'members' ? 'hidden' : ''}>
      ${server.owner_id === state.me?.id
        ? '<p class="srv-role-hint">เจ้าของเซิร์ฟเวอร์สามารถปรับบทบาทสมาชิกแต่ละคนได้ทันที</p>'
        : '<p class="srv-role-hint">เฉพาะเจ้าของเซิร์ฟเวอร์เท่านั้นที่ปรับบทบาทรายบุคคลได้</p>'}
      <div id="srvMembersRows">${renderMemberRolesList(server)}</div>
    </div>`;

  openModal({
    title: `ตั้งค่าเซิร์ฟเวอร์ · ${server.name}`,
    desc: canManage ? 'ปรับแต่งข้อมูลเซิร์ฟเวอร์ ชื่อบทบาท และสิทธิ์ของสมาชิก' : 'ดูข้อมูลเซิร์ฟเวอร์และบทบาทสมาชิก',
    submitText: 'บันทึกการตั้งค่า',
    hideSubmit: !canManage || initialTab === 'members',
    wide: true,
    html,
    onSubmit: async () => {
      if (!canManage) return;
      const payload = readServerFormPayload();
      if (!payload.name) throw new Error('กรุณาใส่ชื่อเซิร์ฟเวอร์');
      const updated = await api(`/servers/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const idx = state.servers.findIndex((s) => s.id === server.id);
      if (idx !== -1) state.servers[idx] = { ...state.servers[idx], ...updated };
      renderRail();
      renderSidebar();
      renderHeader();
      renderMembers();
      toast('บันทึกการตั้งค่าเซิร์ฟเวอร์แล้ว', 'ok');
    },
  });

  wireColorSwatches();
  document.querySelectorAll('[data-srv-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const tab = tabBtn.dataset.srvTab;
      document.querySelectorAll('[data-srv-tab]').forEach((b) => b.classList.toggle('active', b.dataset.srvTab === tab));
      $('srvPaneGeneral').hidden = tab !== 'general';
      $('srvPaneMembers').hidden = tab !== 'members';
      $('modalSubmit').hidden = !canManage || tab !== 'general';
    });
  });

  $('srvMembersRows')?.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-role-user]');
    if (!sel) return;
    const targetId = sel.dataset.roleUser;
    const nextRole = sel.value;
    sel.disabled = true;
    try {
      const res = await api(`/servers/${encodeURIComponent(server.id)}/members/${encodeURIComponent(targetId)}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      if (res?.server) {
        const idx = state.servers.findIndex((s) => s.id === server.id);
        if (idx !== -1) state.servers[idx] = { ...state.servers[idx], ...res.server };
      }
      renderMembers();
      renderSidebar();
      toast('อัปเดตบทบาทสมาชิกแล้ว', 'ok');
    } catch (err) {
      $('modalError').textContent = err.message || 'ปรับบทบาทไม่สำเร็จ';
      sel.value = memberRoleFor(currentServer(), targetId);
    } finally {
      sel.disabled = false;
    }
  });
}

/** Updates a single member role directly (e.g. from profile popout) and refreshes UI. */
export async function changeMemberRole(serverId, userId, nextRole) {
  const res = await api(`/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role: nextRole }),
  });
  if (res?.server) {
    const idx = state.servers.findIndex((s) => s.id === serverId);
    if (idx !== -1) state.servers[idx] = { ...state.servers[idx], ...res.server };
  }
  renderMembers();
  renderSidebar();
  toast('ปรับบทบาทสมาชิกแล้ว', 'ok');
}
