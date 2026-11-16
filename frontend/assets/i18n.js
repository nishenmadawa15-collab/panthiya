// The language shell, shared by every page.
//
// This lived in three copies (app.js, teacher.js, parent.js) before the student and red-team pages
// made it five. One hard rule in here is worth keeping in one place rather than five: strings reach
// the DOM through `textContent` only, never `innerHTML` (requirement 12.7). Model output and parent
// messages all flow through `setText`, so the rule has to hold here or it holds nowhere.
//
// A page uses it like this:
//
//   import { init, t, setText, onLang } from './i18n.mjs';
//   onLang(() => { renderThread(); renderAsk(); });     // re-render on every language change
//   await init({ titleKey: 'parent.heading' });

export const LANGS = ['si', 'ta', 'en'];
export const FALLBACK = 'en';

const STORAGE_KEY = 'panthiya.lang';

const state = { lang: FALLBACK, pack: {} };
const listeners = [];

/** The only way text is allowed to enter the page. */
export function setText(el, value) {
  el.textContent = value;
}

/** "Rs. {amount}" + {amount: 2500} -> "Rs. 2500". */
export function fillSlots(template, values) {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}

/** One pack string, with optional {slot} values. Never returns undefined into the DOM. */
export function t(key, values) {
  const value = state.pack[key];
  if (typeof value !== 'string') {
    console.warn(`[panthiya] missing ${state.lang} key:`, key);
    return '';
  }
  return values ? fillSlots(value, values) : value;
}

export const currentLang = () => state.lang;

/** Register a re-render. Called after every successful language change, in registration order. */
export function onLang(fn) {
  listeners.push(fn);
}

/** Remembered choice, else the device language if we speak it, else English. */
function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch {
    // Private mode or blocked storage: fall through to the device language.
  }
  for (const tag of navigator.languages ?? [navigator.language ?? '']) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return FALLBACK;
}

async function loadPack(lang) {
  const res = await fetch(`/i18n/${lang}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`language pack ${lang} failed: ${res.status}`);
  return res.json();
}

function applyStatic(pack, lang, titleKey) {
  const missing = [];

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = pack[node.dataset.i18n];
    if (typeof value === 'string') setText(node, value);
    else missing.push(node.dataset.i18n);
  }

  // A placeholder is an attribute, not text content, so it needs its own pass.
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    const value = pack[node.dataset.i18nPlaceholder];
    if (typeof value === 'string') node.setAttribute('placeholder', value);
    else missing.push(node.dataset.i18nPlaceholder);
  }

  // Screen readers need to know which language they are pronouncing. (requirement 12.3)
  document.documentElement.lang = pack['meta.lang'] ?? lang;

  if (pack['app.name'] && pack[titleKey]) {
    document.title = `${pack['app.name']} · ${pack[titleKey]}`;
  }
  const desc = document.querySelector('meta[name="description"]');
  if (desc && pack['meta.description']) desc.setAttribute('content', pack['meta.description']);

  for (const btn of document.querySelectorAll('.lang')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
    // The button face is "සිං" / "தமிழ்" / "EN". Spell the language out for assistive tech.
    const full = pack[`lang.${btn.dataset.lang}.full`];
    if (full) btn.setAttribute('aria-label', full);
  }

  // Surfaces an untranslated key immediately instead of at demo time. (task 6.5)
  if (missing.length) console.warn(`[panthiya] missing ${lang} keys:`, missing);
}

function notify(message) {
  const node = document.createElement('p');
  node.className = 'noscript';
  setText(node, message);
  document.body.prepend(node);
}

let titleKeyForPage = 'app.tagline';

export async function setLang(lang, { persist = true } = {}) {
  let pack;
  try {
    pack = await loadPack(lang);
  } catch (err) {
    console.error(err);
    if (lang !== FALLBACK) return setLang(FALLBACK, { persist: false });
    notify('Panthiya could not load its text. Please refresh.');
    return;
  }

  state.pack = pack;
  state.lang = lang;
  applyStatic(pack, lang, titleKeyForPage);

  // Dynamic content is stored as pack keys, so a language switch is a re-render, not a reload:
  // a reply already on screen comes back in the new language.
  for (const fn of listeners) fn();

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not being able to remember the choice is not worth bothering the user about.
    }
  }
}

/** Wire the language buttons and load the first pack. Await it before rendering page data. */
export async function init({ titleKey = 'app.tagline' } = {}) {
  titleKeyForPage = titleKey;

  for (const btn of document.querySelectorAll('.lang')) {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  }

  await setLang(initialLang(), { persist: false });
}
