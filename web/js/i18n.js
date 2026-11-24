/**
 * Central internationalization (i18n) engine for Outbox Chat.
 * Manages supported worldwide locales, browser auto-detection, interpolation,
 * `Intl` date/time formatting locales, static DOM translation, and reactive updates.
 */

import de from './i18n_de.js';
import en from './i18n_en.js';
import es from './i18n_es.js';
import fr from './i18n_fr.js';
import ja from './i18n_ja.js';
import ko from './i18n_ko.js';
import th from './i18n_th.js';
import zh from './i18n_zh.js';

export const LOCALES = { th, en, ja, zh, ko, es, fr, de };

export const SUPPORTED_LANGUAGES = [
  { code: 'auto', nativeName: 'Auto', intlLocale: null },
  { code: 'th', nativeName: 'ไทย', intlLocale: 'th-TH' },
  { code: 'en', nativeName: 'English', intlLocale: 'en-US' },
  { code: 'ja', nativeName: '日本語', intlLocale: 'ja-JP' },
  { code: 'zh', nativeName: '简体中文', intlLocale: 'zh-CN' },
  { code: 'ko', nativeName: '한국어', intlLocale: 'ko-KR' },
  { code: 'es', nativeName: 'Español', intlLocale: 'es-ES' },
  { code: 'fr', nativeName: 'Français', intlLocale: 'fr-FR' },
  { code: 'de', nativeName: 'Deutsch', intlLocale: 'de-DE' },
];

export const ALLOWED_LANGUAGES = SUPPORTED_LANGUAGES.map((l) => l.code);

const STORAGE_KEY = 'ob_lang';
let currentLanguage = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
const listeners = new Set();

/** Normalizes any language code to a supported code or `'auto'`. */
export function normalizeLanguage(raw) {
  const clean = String(raw || '').trim().toLowerCase();
  if (ALLOWED_LANGUAGES.includes(clean)) return clean;
  const base = clean.split(/[-_]/)[0];
  return ALLOWED_LANGUAGES.includes(base) ? base : 'auto';
}

/** Detects the best supported locale from browser `navigator.languages` / `navigator.language`. */
export function detectBrowserLocale() {
  const candidates = [];
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
  }
  for (const tag of candidates) {
    const base = String(tag || '').trim().toLowerCase().split(/[-_]/)[0];
    if (base && LOCALES[base]) return base;
  }
  return 'en';
}

/** Returns the active language setting (`'auto'` or explicit code like `'th'`, `'en'`). */
export function getLanguage() {
  return currentLanguage;
}

/** Resolves the concrete locale code used for dictionary lookup (never `'auto'`). */
export function resolveLocale(lang = currentLanguage) {
  const norm = normalizeLanguage(lang);
  if (norm === 'auto') return detectBrowserLocale();
  return LOCALES[norm] ? norm : 'en';
}

/** Returns a BCP-47 locale tag suitable for `Date.prototype.toLocale*` and `Intl`. */
export function getIntlLocale() {
  if (currentLanguage === 'auto' && typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  const resolved = resolveLocale(currentLanguage);
  return SUPPORTED_LANGUAGES.find((l) => l.code === resolved)?.intlLocale || 'en-US';
}

/** Translates `key` in the active locale with `{var}` interpolation and English fallback. */
export function t(key, vars = {}) {
  const locale = resolveLocale();
  const dict = LOCALES[locale] || LOCALES.en;
  let text = dict[key] ?? LOCALES.en[key] ?? LOCALES.th[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v ?? ''));
  }
  return text;
}

/** Translates common backend English error strings into the active UI language when known. */
export function translateApiError(raw) {
  const msg = String(raw || '').trim();
  if (!msg) return t('error.requestFailed');
  const lower = msg.toLowerCase();
  if (lower.startsWith('slowmode active: wait ')) {
    const secs = msg.slice('slowmode active: wait '.length).replace(/s$/i, '');
    return t('perm.slowmodeWait', { secs });
  }
  const map = {
    'invalid username or password': 'auth.failedLogin',
    'username is already taken': 'auth.failedRegister',
    'session expired': 'auth.sessionExpired',
    'this channel is read-only': 'perm.readOnlyNotice',
    'you are currently timed out in this server': 'mod.timedOutNotice',
    'you are banned from this server': 'mod.bannedError',
    'you cannot access this channel': 'perm.hiddenError',
  };
  const key = map[lower];
  return key ? t(key) : msg;
}

/** Populates `<select>` options with Auto (localized) + native worldwide language names. */
export function renderLanguageOptions(selectEl, selected = currentLanguage) {
  if (!selectEl) return;
  const active = normalizeLanguage(selected);
  selectEl.innerHTML = SUPPORTED_LANGUAGES.map((item) => {
    const label = item.code === 'auto' ? t('lang.auto') : item.nativeName;
    return `<option value="${item.code}" ${item.code === active ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

/** Applies translations to static HTML elements marked with `data-i18n*` attributes. */
export function applyStaticTranslations(root = document) {
  const resolved = resolveLocale();
  if (root === document && document.documentElement) {
    document.documentElement.lang = resolved;
  }
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}

/** Subscribes a callback invoked whenever the active UI language changes. */
export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Sets the active language, updates `localStorage` & DOM attributes, and notifies listeners. */
export function setLanguage(lang, { persistLocal = true, notify = true } = {}) {
  currentLanguage = normalizeLanguage(lang);
  if (persistLocal) {
    try { localStorage.setItem(STORAGE_KEY, currentLanguage); } catch {}
  }
  applyStaticTranslations(document);
  if (notify) {
    for (const fn of listeners) {
      try { fn(currentLanguage, resolveLocale()); } catch {}
    }
  }
}
