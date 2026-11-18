// The accessibility pass, held in place (tasks 6.6 and 6.7; requirements 12.3-12.6).
//
// What this file can and cannot do, said up front so nobody reads a green run as a clean audit:
// these are static checks over the markup, the stylesheet and the scripts. They catch a focus
// outline deleted, a contrast token darkened past the floor, a label that stops matching its
// visible text, a heading level skipped, an @font-face that forgets `unicode-range`. They cannot
// run a screen reader, cannot measure a rendered touch target, and cannot tell you whether a
// reflow at 400% zoom overlaps. Those were tested by reading, not by running, and the lane report
// says so. Automated checks find roughly a third of real barriers; this is that third.
//
// No AWS, no network, no dependencies — same rules as the rest of tests/unit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const bytes = (p) => readFileSync(new URL(p, ROOT));
const size = (p) => statSync(new URL(p, ROOT)).size;

const CSS = read('frontend/assets/styles.css');

/** Every .html file under frontend/, at any depth. */
function htmlFiles(dir = 'frontend') {
  const out = [];
  for (const entry of readdirSync(new URL(dir + '/', ROOT), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...htmlFiles(`${dir}/${entry.name}`));
    else if (entry.name.endsWith('.html')) out.push(`${dir}/${entry.name}`);
  }
  return out;
}

const PAGES = htmlFiles().map((p) => [p, read(p)]);

/* ================================================================================================
   1. Keyboard and focus — requirement 12.4
   ================================================================================================ */

test('req 12.4 — every page has a skip link into a <main id="main">', () => {
  for (const [file, html] of PAGES) {
    assert.match(html, /<a class="skip" href="#main"/, `${file} has no skip link to #main`);
    assert.match(html, /<main id="main">/, `${file} has no <main id="main"> for the skip link to land in`);
  }
});

test('req 12.4 — nothing removes a focus outline', () => {
  // `outline: none` and `outline: 0` are the single commonest way a keyboard user is locked out of
  // a page, and they are never needed here: the one :focus-visible rule below owns the ring.
  const offenders = [...CSS.matchAll(/outline\s*:\s*(none|0)\b/g)].map((m) => m[0]);
  assert.deepEqual(offenders, [], 'styles.css removes a focus outline somewhere');
});

test('req 12.4 — one :focus-visible ring covers every kind of interactive element', () => {
  const rule = CSS.match(/:where\(([^)]*)\):focus-visible\s*\{([^}]*)\}/);
  assert.ok(rule, 'no :focus-visible rule found in styles.css');

  for (const kind of ['a', 'button', 'input', 'select', 'textarea', '[tabindex]']) {
    assert.ok(rule[1].includes(kind), `the :focus-visible rule does not cover ${kind}`);
  }
  assert.match(rule[2], /outline\s*:\s*\d/, 'the :focus-visible rule draws no outline');
});

test('req 12.4 — the skip link becomes visible when it is focused', () => {
  // Off-screen until focused is the whole pattern; a :focus rule that never brings it back is a
  // skip link that exists only in the DOM.
  assert.match(CSS, /\.skip:focus\s*\{[^}]*left\s*:/, '.skip:focus does not move the link on screen');
});

test('req 12.4 — a busy control is aria-disabled, never disabled, so focus is not dropped', () => {
  // Disabling the button the user has just pressed hands focus to <body>: the keyboard loses its
  // place mid-task and the next Tab restarts at the top of the page. Every control in the app that
  // stays busy across a network round-trip — the teacher's microphone, the red-team run button and
  // the three chat send buttons — says it with ARIA instead and guards its own handler.
  const teacher = read('frontend/assets/teacher.js');
  const redteam = read('frontend/assets/redteam.js');
  const student = read('frontend/assets/student.js');
  const parent = read('frontend/assets/parent.js');

  assert.doesNotMatch(teacher, /dom\.mic\.disabled\s*=/, 'teacher.js disables the mic button');
  assert.match(teacher, /dom\.mic\.setAttribute\('aria-disabled'/, 'teacher.js never sets aria-disabled on the mic');
  assert.match(teacher, /micView\(state\.mic\.phase\)\.busy\)\s*return/, 'the mic click handler does not ignore a busy press');

  assert.doesNotMatch(redteam, /dom\.run\.disabled\s*=/, 'redteam.js disables the run button');
  assert.match(redteam, /dom\.run\.setAttribute\('aria-disabled'/, 'redteam.js never sets aria-disabled on the run button');
  assert.match(redteam, /if \(state\.running\) return;/, 'run() does not ignore a second press');

  // The three send buttons, which were the same defect: a hard `disabled` held for the whole
  // Bedrock round-trip, which on a slow link is seconds of focus sitting on <body>.
  for (const [file, source, button, busy] of [
    ['teacher.js', teacher, 'dom.send', 'state.sending'],
    ['student.js', student, 'dom.send', 'state.sending'],
    ['parent.js', parent, 'dom.askSend', 'state.asking'],
  ]) {
    const name = button.replace('dom.', '').replace(/[^\w]/g, '');
    assert.doesNotMatch(
      source, new RegExp(`${button.replace('.', '\\.')}\\.disabled\\s*=`),
      `${file} disables the ${name} button, which drops focus to <body> for the whole request`,
    );
    assert.match(
      source, new RegExp(`${button.replace('.', '\\.')}\\.setAttribute\\('aria-disabled'`),
      `${file} never sets aria-disabled on the ${name} button`,
    );
    assert.match(
      source, new RegExp(`if \\(${busy.replace('.', '\\.')}\\) return;`),
      `${file} has no busy guard, so an aria-disabled button is still clickable`,
    );
  }

  // The red-team layer checkboxes are the one place `disabled` is still right: aria-disabled on a
  // native checkbox does not stop a click toggling it, and a layer that moves mid-run is exactly
  // what the runner answers 400 layers_changed for. Nothing is dropped either — a run can only
  // start from the run button, so focus is never on a checkbox when the lock goes on.
  assert.match(redteam, /for \(const box of dom\.layerBoxes\) box\.disabled = state\.locked;/,
    'the layer checkboxes no longer actually prevent a change during a run');

  // And an aria-disabled control still has to look unavailable.
  assert.match(CSS, /\[aria-disabled="true"\]/, 'styles.css has no aria-disabled styling');
  assert.match(
    CSS, /\.composer__send\[aria-disabled="true"\]\s*\{/,
    'the send button has no aria-disabled styling, so a busy send looks available',
  );

  // The focus() that used to paper over the dropped focus has to go with it: once the button keeps
  // focus, forcing it back into the input steals it from wherever the user moved while waiting.
  for (const [file, source] of [['teacher.js', teacher], ['student.js', student], ['parent.js', parent]]) {
    for (const block of source.match(/\} finally \{[\s\S]*?\n  \}/g) ?? []) {
      assert.doesNotMatch(block, /\.focus\(\)/, `${file} still forces focus in a finally block`);
    }
  }
});

test('req 12.4 — the sideways-scrolling case table is reachable by keyboard', () => {
  // Six columns do not fit a phone, so .redteam-scroll scrolls. A scroll container that is not
  // focusable cannot be scrolled without a pointer.
  const html = read('frontend/redteam/index.html');
  const region = html.match(/<div class="redteam-scroll"[^>]*>/);
  assert.ok(region, 'the .redteam-scroll container is gone');
  assert.match(region[0], /tabindex="0"/, 'the scroll region is not focusable');
  assert.match(region[0], /aria-labelledby=|aria-label=/, 'the scroll region has no accessible name');
});

/* ================================================================================================
   2. Structure, names and status — 1.3.1, 2.4.6, 4.1.2, 4.1.3
   ================================================================================================ */

test('1.3.1 — one <h1> per page and no heading level skipped', () => {
  for (const [file, html] of PAGES) {
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((l) => l === 1).length, 1, `${file} does not have exactly one <h1>`);

    let previous = 0;
    for (const level of levels) {
      if (previous) {
        assert.ok(level <= previous + 1, `${file} jumps from h${previous} to h${level}`);
      }
      previous = level;
    }
  }
});

test('1.3.1 — every form control in the markup carries a name', () => {
  for (const [file, html] of PAGES) {
    const labelled = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
    for (const control of html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []) {
      const id = control.match(/\bid="([^"]+)"/)?.[1];
      const named = (id && labelled.has(id)) || /aria-label(?:ledby)?=/.test(control);
      assert.ok(named, `${file} has an unlabelled control: ${control}`);
    }
  }
});

test('4.1.3 — the red-team tally announces itself as a run progresses', () => {
  // Five score tiles are rebuilt per case, so the live region is the one headline sentence rather
  // than the tile list: a live region on the tiles would read all five numbers 36 times over.
  const html = read('frontend/redteam/index.html');
  const headline = html.match(/<p class="redteam-score__by-layer"[\s\S]*?>/);
  assert.ok(headline, 'the by-layer headline is gone');
  assert.match(headline[0], /aria-live="polite"/, 'the by-layer tally is not a live region');

  assert.doesNotMatch(
    html,
    /<ul class="redteam-score"[^>]*aria-live/,
    'the score tile list is a live region; it would re-announce all five numbers per case',
  );
});

test('2.5.3 — the reply toggle\'s accessible name contains the words on it, and follows its state', () => {
  // It used to carry aria-label="Read the reply to case R-01" while the button said "Read reply":
  // the visible label was not contained in the accessible name, so voice control could not reach
  // it, and the *show* wording was used even when the button said "Hide reply" (4.1.2). The fix is
  // the show_case/hide_case pair, whose whole basis is that each one starts with the words of the
  // plain key — in Sinhala and Tamil as well as English, which is what this checks.
  const redteam = read('frontend/assets/redteam.js');
  const block = redteam.match(/const button = el\('button', 'redteam-reply-toggle'[\s\S]{0,1600}?replyCell\.append/);
  assert.ok(block, 'the reply toggle is no longer built where this test looks');

  // The name is set, and it is the state-aware key — not the old always-"show" one.
  assert.match(block[0], /setAttribute\(\s*'aria-label'/, 'the reply toggle sets no aria-label');
  assert.match(
    block[0], /open \? 'redteam\.reply\.hide_case' : 'redteam\.reply\.show_case'/,
    'the accessible name does not follow the open/closed state, so an open button announces "read"',
  );
  assert.match(
    block[0], /t\(open \? 'redteam\.reply\.hide' : 'redteam\.reply\.show'\)/,
    'the visible label is not the plain show/hide pair the accessible name has to contain',
  );
  assert.match(block[0], /aria-expanded/, 'the reply toggle does not expose its expanded state');
  assert.match(block[0], /aria-controls/, 'the reply toggle does not point at what it opens');

  for (const lang of ['en', 'si', 'ta']) {
    const pack = JSON.parse(read(`frontend/i18n/${lang}.json`));
    for (const [plain, withCase] of [['show', 'show_case'], ['hide', 'hide_case']]) {
      const label = pack[`redteam.reply.${plain}`];
      const name = pack[`redteam.reply.${withCase}`];
      assert.ok(label && name, `${lang}.json is missing redteam.reply.${plain} or .${withCase}`);
      // WCAG 2.5.3 Label in Name: the visible words have to be *in* the accessible name, or a
      // voice-control user saying what the button says matches nothing.
      assert.ok(
        name.startsWith(label),
        `${lang}: redteam.reply.${withCase} ("${name}") does not start with the visible label ("${label}")`,
      );
      assert.ok(name.includes('{id}'), `${lang}: redteam.reply.${withCase} carries no {id} to fill`);
    }
  }
});

/* ================================================================================================
   3. Contrast — requirement 12.5
   ================================================================================================ */

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TOKENS = Object.fromEntries(
  [...CSS.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]),
);

// Every background a word is ever set on in this app.
const BACKGROUNDS = { paper: TOKENS.paper, 'paper-edge': TOKENS['paper-edge'], sheet: '#FFFFFF', caution: '#FFF4D6' };

test('req 12.5 — every ink meets 4.5:1 on every background it is used on', () => {
  const inks = ['ink', 'ink-soft', 'stamp-paid', 'stamp-absent', 'stamp-draft', 'focus'];
  for (const ink of inks) {
    assert.ok(TOKENS[ink], `--${ink} is missing from styles.css`);
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      const r = ratio(TOKENS[ink], background);
      assert.ok(r >= 4.5, `--${ink} (${TOKENS[ink]}) is ${r.toFixed(2)}:1 on ${name}, needs 4.5:1`);
    }
  }
});

test('req 12.5 — the focus ring meets 3:1 against every background it is drawn over', () => {
  for (const [name, background] of Object.entries(BACKGROUNDS)) {
    const r = ratio(TOKENS.focus, background);
    assert.ok(r >= 3, `--focus is ${r.toFixed(2)}:1 on ${name}, needs 3:1 as a non-text indicator`);
  }
});

test('req 12.5 — the ratio written beside each token is the ratio it actually has', () => {
  // The comments are the only contrast documentation in the repo, so a stale one is worse than
  // none: it tells the next person a check was done that was not.
  const commented = [...CSS.matchAll(
    /--([\w-]+):\s*(#[0-9A-Fa-f]{6});\s*\/\*\s*([\d.]+):1 on paper\s*·\s*([\d.]+):1 on paper-edge/g,
  )];
  assert.ok(commented.length >= 6, 'the token contrast comments have gone missing');

  for (const [, name, hex, onPaper, onEdge] of commented) {
    assert.equal(
      ratio(hex, TOKENS.paper).toFixed(2), Number(onPaper).toFixed(2),
      `--${name} says ${onPaper}:1 on paper but is ${ratio(hex, TOKENS.paper).toFixed(2)}:1`,
    );
    assert.equal(
      ratio(hex, TOKENS['paper-edge']).toFixed(2), Number(onEdge).toFixed(2),
      `--${name} says ${onEdge}:1 on paper-edge but is ${ratio(hex, TOKENS['paper-edge']).toFixed(2)}:1`,
    );
  }
});

test('req 12.5 — a contrast ratio written out in prose is the ratio it actually has', () => {
  // The test above only matches the `--name: #hex; /* N:1 on paper · N:1 on paper-edge */` shape,
  // so it is structurally blind to the section headers, which write ratios out in sentences. That
  // is exactly how "--stamp-draft … 4.8:1 on paper" and "--stamp-paid … 5.0:1 on paper and 5.7:1
  // on white" survived a measurement pass. This reads every ratio anywhere in the file, attributes
  // it to the nearest ink token named before it, and checks it at the precision it was written to.
  const INKS = ['ink-soft', 'ink', 'stamp-paid', 'stamp-absent', 'stamp-draft', 'focus'];
  const NAMED = { paper: TOKENS.paper, 'paper-edge': TOKENS['paper-edge'], white: '#FFFFFF', '#FFF4D6': '#FFF4D6' };
  // 4.5:1 and 3:1 are the WCAG floors this file quotes at itself, not claims about a colour.
  const FLOORS = new Set(['4.5', '3']);
  const inkBefore = new RegExp(`--(${INKS.join('|')})(?![\\w-])`, 'g');

  let checked = 0;
  for (const comment of CSS.matchAll(/\/\*[\s\S]*?\*\//g)) {
    // The scope a number is read in is its own comment plus the start of the line the comment
    // opens on, which is what makes `--ink: #1E2733; /* 14.10:1 on paper */` attributable.
    const from = CSS.lastIndexOf('\n', comment.index) + 1;
    const scope = CSS.slice(from, comment.index + comment[0].length);

    for (const m of scope.matchAll(/(\d[\d.]*):1(?:\s+on\s+(?:the\s+)?(#[0-9A-Fa-f]{6}|-{0,2}[\w-]+))?/g)) {
      const [, stated, background] = m;
      if (FLOORS.has(stated)) continue;

      // Prose that quotes a ratio without naming the ink is the hole the two stale numbers lived
      // in: "Amber ink is … at 4.8:1 on paper" was unattributable, so nothing could check it.
      const ink = [...scope.slice(0, m.index).matchAll(inkBefore)].pop()?.[1];
      assert.ok(
        ink,
        `"${stated}:1" is written with no ink token named before it, so nobody can check it: ${scope.trim().slice(0, 80)}`,
      );

      const hex = TOKENS[ink];
      const places = (stated.split('.')[1] ?? '').length;
      const wanted = Number(stated).toFixed(places);
      const surface = background ? NAMED[background.replace(/^--/, '')] : undefined;

      if (surface) {
        assert.equal(
          ratio(hex, surface).toFixed(places), wanted,
          `--${ink} is written as ${stated}:1 on ${background} but is ${ratio(hex, surface).toFixed(2)}:1`,
        );
      } else {
        // No background named right after the number ("--ink on it is 13.75:1", "(7.04:1)"): then
        // it has to at least be a real ratio for that ink on a surface the app paints on.
        const options = Object.entries(BACKGROUNDS).map(([name, bg]) => [name, ratio(hex, bg)]);
        assert.ok(
          options.some(([, r]) => r.toFixed(places) === wanted),
          `--${ink} is written as ${stated}:1, which is none of ${options.map(([n, r]) => `${r.toFixed(2)} on ${n}`).join(', ')}`,
        );
      }
      checked += 1;
    }
  }

  // The two stale numbers were both in prose. If this count collapses, either the prose documenting
  // the palette has gone or this scan has stopped finding it, and the blind spot is back.
  assert.ok(checked >= 30, `only ${checked} contrast ratios were found in styles.css`);
});

/* ================================================================================================
   4. Motion and language — requirements 12.6 and 12.3
   ================================================================================================ */

test('req 12.6 — prefers-reduced-motion stops every animation and transition', () => {
  const block = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'no prefers-reduced-motion block in styles.css');

  // The `*` selector is what makes this hold for sections appended later without a second thought.
  assert.match(block[1], /\*,\s*\*::before,\s*\*::after/, 'the reduced-motion block does not match every element');
  for (const property of ['animation-duration', 'animation-iteration-count', 'transition-duration']) {
    assert.match(
      block[1], new RegExp(`${property}:[^;]*!important`),
      `the reduced-motion block does not override ${property} with !important`,
    );
  }
});

test('req 12.6 — no animation outruns the reduced-motion override', () => {
  // Every animation in the file is a 160ms arrival. A long or looping one would be a vestibular
  // hazard on any browser that reports no motion preference at all.
  for (const [, duration] of CSS.matchAll(/animation:\s*[\w-]+\s+(\d+)ms/g)) {
    assert.ok(Number(duration) <= 400, `a ${duration}ms animation is too long for an arrival`);
  }
  assert.doesNotMatch(CSS, /animation[^;]*\binfinite\b/, 'styles.css has an infinite animation');
});

test('req 12.3 — the document language is switched with the picker, not left at en', () => {
  const i18n = read('frontend/assets/i18n.js');
  assert.match(i18n, /document\.documentElement\.lang\s*=/, 'i18n.js never updates the document lang');

  for (const [file, html] of PAGES) {
    assert.match(html, /<html lang="[a-z]{2}"/, `${file} ships without an initial html lang`);
  }

  // Each picker button is in the language it offers, so a screen reader reads "සිං" with a Sinhala
  // voice rather than spelling it out in English.
  for (const [file, html] of PAGES) {
    if (!html.includes('class="lang"')) continue;
    for (const lang of ['si', 'ta', 'en']) {
      assert.match(
        html, new RegExp(`class="lang" data-lang="${lang}" lang="${lang}"`),
        `${file}: the ${lang} picker button does not declare its own lang`,
      );
    }
  }
});

/* ================================================================================================
   5. Touch targets — WCAG 2.2 2.5.8, and the 44px the design asks for
   ================================================================================================ */

test('2.5.8 — every interactive class keeps a 44px target', () => {
  const required = [
    '.lang', '.composer__input', '.redteam-layer', '.redteam-reply-toggle',
  ];
  for (const selector of required) {
    const block = CSS.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
    assert.ok(block, `${selector} is gone from styles.css`);
    const min = block[1].match(/min-height:\s*([\d.]+)rem/);
    assert.ok(min, `${selector} declares no min-height, so its target size is whatever the text is`);
    assert.ok(Number(min[1]) >= 2.75, `${selector} is ${min[1]}rem tall, under the 2.75rem (44px) floor`);
  }

  // The mic and send buttons share one block and need a width floor too: a square icon button that
  // is 44px tall and 20px wide is still a miss on a phone.
  const buttons = CSS.match(/\.composer__mic,\s*\n\.composer__send \{([^}]*)\}/);
  assert.ok(buttons, 'the .composer__mic/.composer__send block is gone');
  assert.match(buttons[1], /min-height:\s*2\.75rem/, 'the composer buttons lost their height floor');
  assert.match(buttons[1], /min-width:\s*2\.75rem/, 'the composer buttons lost their width floor');
});

/* ================================================================================================
   6. Self-hosted Sinhala and Tamil — task 6.6, design §8.2
   ================================================================================================ */

const FACES = [...CSS.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);

test('task 6.6 — the Sinhala and Tamil faces are self-hosted and declared properly', () => {
  assert.equal(FACES.length, 2, 'expected exactly two @font-face rules, Sinhala and Tamil');

  for (const face of FACES) {
    const family = face.match(/font-family:\s*"([^"]+)"/)?.[1];
    assert.ok(family, 'an @font-face has no font-family');

    // `swap` is what answers design §8.2's objection to self-hosting: the device face paints
    // first, so the download never holds up first paint.
    assert.match(face, /font-display:\s*swap/, `${family} does not use font-display: swap`);

    // unicode-range is the other half: an English page must not fetch a Sinhala face.
    assert.match(face, /unicode-range:/, `${family} has no unicode-range, so it downloads everywhere`);

    // Same origin, because customHttp.yml's CSP is `font-src 'self'` and a CDN is not an option.
    const url = face.match(/url\("(\/assets\/fonts\/[\w.-]+\.woff2)"\)/);
    assert.ok(url, `${family} is not loaded from /assets/fonts/ as woff2`);
    assert.match(face, /format\("woff2"\)/, `${family} does not declare format("woff2")`);

    // And the file is really there, and really a woff2.
    const file = `frontend${url[1]}`;
    assert.equal(bytes(file).subarray(0, 4).toString('latin1'), 'wOF2', `${file} is not a woff2 binary`);
  }
});

test('task 6.6 — the two ranges do not overlap, so a Tamil page never pulls the Sinhala file', () => {
  const ranges = FACES.map((face) => {
    const list = face.match(/unicode-range:\s*([^;]+);/)[1];
    const set = new Set();
    for (const part of list.split(',')) {
      const [from, to] = part.trim().replace(/U\+/g, '').split('-');
      const start = parseInt(from, 16);
      const end = to ? parseInt(to, 16) : start;
      for (let cp = start; cp <= end; cp += 1) set.add(cp);
    }
    return set;
  });

  const shared = [...ranges[0]].filter((cp) => ranges[1].has(cp));
  assert.deepEqual(shared, [], `the two faces share codepoints: ${shared.map((c) => c.toString(16))}`);
});

test('task 6.6 — the font payload stays small enough to be worth self-hosting', () => {
  // The whole point of the subsets. If this ever fails, someone has added a face rather than
  // trimming one, and a 3G phone is paying for it — which is precisely what design §8.2 feared.
  const total = FACES
    .map((face) => `frontend${face.match(/url\("([^"]+)"\)/)[1]}`)
    .reduce((sum, file) => sum + size(file), 0);

  assert.ok(total <= 256 * 1024, `the self-hosted fonts total ${total} bytes, over the 256 KB budget`);
});

test('task 6.6 — the OFL licence travels with the binaries', () => {
  // SIL OFL 1.1 requires it, and a font binary in a repo with no licence beside it is a liability.
  const licence = read('frontend/assets/fonts/OFL.txt');
  assert.match(licence, /SIL OPEN FONT LICENSE/i, 'fonts/OFL.txt is not the Open Font License');
});

test('task 6.6 — the picker and brand mark name no webfont, so an English page downloads none', () => {
  // "සිං", "தமிழ்" and "ප" are on every page, English included. Eight characters are not worth
  // 180 KB, so those three elements use the device stack and nothing else.
  const stack = CSS.match(/--font-ui-indic:([^;]+);/);
  assert.ok(stack, '--font-ui-indic is gone');
  assert.doesNotMatch(stack[1], /Noto Sans (Sinhala|Tamil)/, '--font-ui-indic names a webfont family');

  for (const selector of ['.lang', '.brand__mark']) {
    const block = CSS.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
    assert.ok(block, `${selector} is gone from styles.css`);
    assert.match(block[1], /font-family:\s*var\(--font-ui-indic\)/, `${selector} does not use the device-only stack`);
  }
});
