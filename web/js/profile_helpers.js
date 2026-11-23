/**
 * Profile resolution (global + per-server overrides) and client-side image
 * crop/compression helpers for avatars and profile banners.
 */

import { t } from './i18n.js';
import { $, currentServer, safeAvatarUrl, safeColor, state } from './state.js';

/** Resolves effective user profile inside `server` (merging per-server overrides). */
export function resolveProfile(userOrId, server = currentServer()) {
  const uid = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  const base =
    typeof userOrId === 'object' && userOrId
      ? userOrId
      : (server?.members?.find((m) => m.id === uid) ||
          (state.me?.id === uid ? state.me : null) ||
          state.friends?.friends?.find((f) => f.user.id === uid)?.user || {
            id: uid,
            username: 'user',
            display_name: t('common.member'),
            color: '#5865f2',
            bot: false,
          });
  const srvProf = !state.homeMode && server?.member_profiles?.[base.id];
  if (!srvProf) return base;
  return {
    ...base,
    display_name: srvProf.nickname || base.display_name,
    avatar_url: srvProf.avatar_url || base.avatar_url,
    banner_url: srvProf.banner_url || base.banner_url,
    bio: srvProf.bio || base.bio,
  };
}

/** Returns inline CSS `background` styling for a profile banner (image or fallback color). */
export function bannerStyle(profile) {
  const img = safeAvatarUrl(profile?.banner_url);
  if (img) {
    return `background:url('${img}') center/cover no-repeat,${safeColor(profile?.color)}`;
  }
  return `background:${safeColor(profile?.color)}`;
}

/** Center-crops and compresses an uploaded image file to `width x height` WebP/JPEG data URL. */
export async function resizeImageFile(file, width, height, maxBytes) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('load failed'));
      el.src = url;
    });
    const targetRatio = width / height;
    const srcRatio = img.width / img.height;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    if (srcRatio > targetRatio) {
      sw = Math.round(img.height * targetRatio);
      sx = Math.round((img.width - sw) / 2);
    } else {
      sh = Math.round(img.width / targetRatio);
      sy = Math.round((img.height - sh) / 2);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    for (const q of [0.84, 0.7, 0.56]) {
      const webp = canvas.toDataURL('image/webp', q);
      if (webp.startsWith('data:image/webp') && webp.length <= maxBytes) return webp;
      const jpeg = canvas.toDataURL('image/jpeg', q);
      if (jpeg.length <= maxBytes) return jpeg;
    }
    throw new Error('image too large');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Wires trigger buttons, clear button, and file input resizing for profile image pickers. */
export function wireImageInput({ inputId, clearId, triggers, width, height, maxBytes, onSet, onError, errKey }) {
  triggers.forEach((id) => $(id)?.addEventListener('click', () => $(inputId)?.click()));
  $(clearId)?.addEventListener('click', () => {
    onSet('');
    if ($(inputId)) $(inputId).value = '';
  });
  $(inputId)?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onError('');
    try { onSet(await resizeImageFile(file, width, height, maxBytes)); }
    catch { onError(t(errKey)); }
  });
}
