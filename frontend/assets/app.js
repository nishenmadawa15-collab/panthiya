// Panthiya front-end shell: load a language pack, fill the page, remember the choice.
//
// One hard rule in this file: strings reach the DOM through textContent only, never innerHTML.
// Model output and parent messages will flow through the same helper in later milestones, so the
// rule has to hold from the first line of the project. (requirement 12.7)

const LANGS = ['si', 'ta', 'en'];
const FALLBACK = 'en';
const STORAGE_KEY = 'panthiya.lang';

/** The only way text is allowed to enter the page. */
function setText(el, value) {
  el.textContent = value;
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

function apply(pack, lang) {
  const missing = [];

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    const value = pack[key];
    if (typeof value === 'string') setText(el, value);
    else missing.push(key);
  }

  // Screen readers need to know which language they are pronouncing. (requirement 12.3)
  document.documentElement.lang = pack['meta.lang'] ?? lang;

  if (pack['app.name'] && pack['app.tagline']) {
    document.title = `${pack['app.name']} · ${pack['app.tagline']}`;
  }
  const desc = document.querySelector('meta[name="description"]');
  if (desc && pack['meta.description']) desc.setAttribute('content', pack['meta.description']);

  for (const btn of document.querySelectorAll('.lang')) {
    const isCurrent = btn.dataset.lang === lang;
    btn.setAttribute('aria-pressed', String(isCurrent));
    // The button face is "සිං" / "தமிழ்" / "EN". Spell the language out for assistive tech.
    const full = pack[`lang.${btn.dataset.lang}.full`];
    if (full) btn.setAttribute('aria-label', full);
  }

  // Surfaces an untranslated key immediately instead of at demo time. (task 6.5)
  if (missing.length) console.warn(`[panthiya] missing ${lang} keys:`, missing);
}

function notify(message) {
  const el = document.createElement('p');
  el.className = 'noscript';
  setText(el, message);
  document.body.prepend(el);
}

async function setLang(lang, { persist = true } = {}) {
  let pack;
  try {
    pack = await loadPack(lang);
  } catch (err) {
    console.error(err);
    if (lang !== FALLBACK) return setLang(FALLBACK, { persist: false });
    notify('Panthiya could not load its text. Please refresh.');
    return;
  }

  apply(pack, lang);

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not being able to remember the choice is not worth bothering the user about.
    }
  }
}

for (const btn of document.querySelectorAll('.lang')) {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
}

setLang(initialLang(), { persist: false });
