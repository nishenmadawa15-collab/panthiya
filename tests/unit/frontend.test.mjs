// Offline checks for the front-end shell. No AWS, no network, no dependencies — so the
// run-unit-tests Kiro hook can run this on every save for free.
//
// Guards requirement 12.2 (every string lives in i18n) and 12.5 (contrast ratios).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

const LANGS = ['si', 'ta', 'en'];
const packs = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`frontend/i18n/${l}.json`))]));

/** Every .html file under frontend/, at any depth. */
function htmlFiles(dir = 'frontend') {
  const out = [];
  for (const entry of readdirSync(new URL(dir + '/', ROOT), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...htmlFiles(`${dir}/${entry.name}`));
    else if (entry.name.endsWith('.html')) out.push(`${dir}/${entry.name}`);
  }
  return out;
}

test('every language pack has the same key set', () => {
  const reference = Object.keys(packs.en).sort();
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(packs[lang]).sort(), reference, `${lang}.json key set differs from en.json`);
  }
});

test('no language pack has an empty string', () => {
  for (const lang of LANGS) {
    for (const [key, value] of Object.entries(packs[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} is not a string`);
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
    }
  }
});

test('every data-i18n key in the markup exists in all three packs', () => {
  for (const file of htmlFiles()) {
    const keys = [...read(file).matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 0, `${file} has no data-i18n attributes`);
    for (const key of keys) {
      for (const lang of LANGS) {
        assert.equal(typeof packs[lang][key], 'string', `${file} uses "${key}", missing from ${lang}.json`);
      }
    }
  }
});

test('markup carries no inline style or script, so the strict CSP holds', () => {
  for (const file of htmlFiles()) {
    const html = read(file);
    assert.ok(!/<style[\s>]/i.test(html), `${file} has an inline <style>; CSP forbids style-src unsafe-inline`);
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), `${file} has an inline <script>; CSP forbids script-src unsafe-inline`);
    assert.ok(!/\son\w+=/i.test(html), `${file} has an inline event handler attribute`);
  }
});

/** Drop comments, so a rule written *about* innerHTML is not mistaken for a use of it.
    ponytail: a regex, not a parser. Fine while no string literal in this project contains "//". */
const stripComments = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('no script writes to innerHTML', () => {
  for (const name of readdirSync(new URL('frontend/assets/', ROOT))) {
    if (!name.endsWith('.js')) continue;
    const code = stripComments(read(`frontend/assets/${name}`));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code),
      `frontend/assets/${name} writes HTML; requirement 12.7 allows textContent only`);
  }
});

// --- contrast (requirement 12.5) ---------------------------------------------------------------

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull the design tokens straight out of the stylesheet, so the test reads the real values. */
function tokens() {
  const css = read('frontend/assets/styles.css');
  return Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}

test('ink colours meet 4.5:1 on paper, and the focus ring meets 3:1', () => {
  const t = tokens();
  const paper = t.paper;
  assert.ok(paper, '--paper token not found in styles.css');

  for (const name of ['ink', 'ink-soft', 'stamp-paid', 'stamp-absent', 'stamp-draft']) {
    const r = ratio(t[name], paper);
    assert.ok(r >= 4.5, `--${name} (${t[name]}) is ${r.toFixed(2)}:1 on paper, needs 4.5:1`);
  }

  const focus = ratio(t.focus, paper);
  assert.ok(focus >= 3, `--focus (${t.focus}) is ${focus.toFixed(2)}:1 on paper, needs 3:1`);

  // The pressed language button inverts: paper text on ink.
  assert.ok(ratio(paper, t.ink) >= 4.5, 'pressed language button fails contrast');
});

test('front-end scripts are .js, never .mjs', () => {
  // A .mjs file is served as text/plain by several static servers, and a browser refuses to
  // execute a module with a non-JavaScript MIME type — silently. The whole site rendered with
  // every string blank and not one console error. Browsers do not need .mjs; the type="module"
  // attribute already says it is a module. Node is the only thing here that needs the extension.
  for (const name of readdirSync(new URL('frontend/assets/', ROOT))) {
    assert.ok(!name.endsWith('.mjs'),
      `frontend/assets/${name}: rename to .js, or it may be served as text/plain and never run`);
  }

  for (const file of htmlFiles()) {
    const html = read(file);
    assert.ok(!/src="[^"]*\.mjs"/.test(html), `${file} loads a .mjs script`);
  }
});
