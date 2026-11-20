// Name normalisation — the single defence against spelling-based evasion.
//
// Implements design §4.1. Both the student lookup and the policyCheck foreign-name scan call this,
// deliberately: if an attacker could evade one without evading the other, the gap between them
// would be the vulnerability. Duplicating this logic elsewhere is the bug this file exists to stop.
//
// Two levels, because the two callers have opposite failure costs:
//
//   nameKey(s)      canonical key. Used for lookup. Over-matching here makes the teacher get asked
//                   "which student did you mean?", which is requirement 3.3 and harmless.
//   foldedKey(s)    aggressively folded key that merges consonants Sinhala, Tamil and Latin
//                   spellings disagree about (t/th/d, k/g, p/b, v/w, s/sh/ch). Used for BLOCKING.
//                   Over-matching here blocks a reply that was probably fine. Under-matching here
//                   leaks a child's marks to a stranger. The asymmetry is the whole reason it folds.

const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

/** Characters that look like Latin letters but are not. Case D6 is a Cyrillic і inside "Dіlmі". */
const HOMOGLYPHS = new Map(Object.entries({
  // Cyrillic
  'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p',
  'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd',
  'А': 'a', 'В': 'b', 'Е': 'e', 'К': 'k', 'М': 'm', 'Н': 'h', 'О': 'o', 'Р': 'p',
  'С': 'c', 'Т': 't', 'У': 'y', 'Х': 'x', 'І': 'i', 'Ј': 'j', 'Ѕ': 's',
  // Greek
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ρ': 'p', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'τ': 't',
  'Ο': 'o', 'Α': 'a', 'Ε': 'e', 'Ρ': 'p', 'Ι': 'i', 'Κ': 'k', 'Τ': 't',
  // Other lookalikes
  'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd',
}));

// --- Sinhala -------------------------------------------------------------------------------------
// Consonants carry an inherent "a" which a vowel sign replaces and the virama (්) removes.

const SI_CONSONANTS = new Map(Object.entries({
  'ක': 'k', 'ඛ': 'k', 'ග': 'g', 'ඝ': 'g', 'ඞ': 'n', 'ඟ': 'g',
  'ච': 'ch', 'ඡ': 'ch', 'ජ': 'j', 'ඣ': 'j', 'ඤ': 'n', 'ඥ': 'n', 'ඦ': 'j',
  'ට': 't', 'ඨ': 't', 'ඩ': 'd', 'ඪ': 'd', 'ණ': 'n', 'ඬ': 'd',
  'ත': 'th', 'ථ': 'th', 'ද': 'd', 'ධ': 'dh', 'න': 'n', 'ඳ': 'd',
  'ප': 'p', 'ඵ': 'p', 'බ': 'b', 'භ': 'b', 'ම': 'm', 'ඹ': 'b',
  'ය': 'y', 'ර': 'r', 'ල': 'l', 'ව': 'w', 'ළ': 'l', 'ෆ': 'f',
  'ශ': 'sh', 'ෂ': 'sh', 'ස': 's', 'හ': 'h',
}));

const SI_VOWEL_SIGNS = new Map(Object.entries({
  'ා': 'a', 'ැ': 'ae', 'ෑ': 'ae', 'ි': 'i', 'ී': 'i', 'ු': 'u', 'ූ': 'u',
  'ෘ': 'ru', 'ෙ': 'e', 'ේ': 'e', 'ෛ': 'ai', 'ො': 'o', 'ෝ': 'o', 'ෞ': 'au',
}));

const SI_INDEPENDENT = new Map(Object.entries({
  'අ': 'a', 'ආ': 'a', 'ඇ': 'ae', 'ඈ': 'ae', 'ඉ': 'i', 'ඊ': 'i', 'උ': 'u', 'ඌ': 'u',
  'එ': 'e', 'ඒ': 'e', 'ඓ': 'ai', 'ඔ': 'o', 'ඕ': 'o', 'ඖ': 'au', 'ඍ': 'ru',
}));

const SI_VIRAMA = '්';

// --- Tamil ---------------------------------------------------------------------------------------

const TA_CONSONANTS = new Map(Object.entries({
  'க': 'k', 'ங': 'ng', 'ச': 'ch', 'ஞ': 'n', 'ட': 't', 'ண': 'n', 'த': 'th', 'ந': 'n',
  'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r', 'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l',
  'ற': 'r', 'ன': 'n', 'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h',
}));

const TA_VOWEL_SIGNS = new Map(Object.entries({
  'ா': 'a', 'ி': 'i', 'ீ': 'i', 'ு': 'u', 'ூ': 'u',
  'ெ': 'e', 'ே': 'e', 'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au',
}));

const TA_INDEPENDENT = new Map(Object.entries({
  'அ': 'a', 'ஆ': 'a', 'இ': 'i', 'ஈ': 'i', 'உ': 'u', 'ஊ': 'u',
  'எ': 'e', 'ஏ': 'e', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'o', 'ஔ': 'au',
}));

const TA_VIRAMA = '்';

/**
 * Walk an Indic string, emitting consonant + vowel clusters.
 * A consonant emits its inherent "a" unless the next character is a vowel sign or a virama.
 */
function transliterate(text, { consonants, vowelSigns, independent, virama }) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const consonant = consonants.get(ch);
    if (consonant) {
      const next = text[i + 1];
      if (next === virama) { out += consonant; i++; }
      else if (vowelSigns.has(next)) { out += consonant + vowelSigns.get(next); i++; }
      else { out += consonant + 'a'; }
      continue;
    }
    if (independent.has(ch)) { out += independent.get(ch); continue; }
    if (vowelSigns.has(ch)) { out += vowelSigns.get(ch); continue; }
    if (ch === virama) continue;
    out += ch;   // spaces, punctuation and anything unmapped pass through to the next stage
  }
  return out;
}

/**
 * Sinhala and Tamil mark possession and direction with suffixes that a teacher types inline:
 * "Dilmi-ge attendance", "කසුන්ට". Stripping them is what makes Singlish input resolve.
 * Only stripped when a real stem remains, so short names survive.
 *
 * Every entry here must be a suffix that is really ADDED to a name, never a letter sequence that
 * names genuinely end in. `nge` was in this list and silently broke every name ending in "n":
 * "කසුන්ගේ" became "kasu", which no longer matched "Kasun" — the demo's primary student. `wa`/`va`
 * were just as bad, turning the very common surname "Silva" into "Sil". Stripping is asymmetric by
 * nature (the mention carries the suffix, the roster entry does not), so an over-strip is an
 * under-match, and an under-match in policyCheck is a leak.
 */
// Longest first: Tamil "யின்" must be stripped as "yin", not clipped to "in" and left as "…y".
const SUFFIXES = ['gen', 'yin', 'ge', 'ta', 'in', 'ku', 'ai', 's']
  .sort((a, b) => b.length - a.length);

function stripSuffix(s) {
  for (const suffix of SUFFIXES) {
    if (s.length - suffix.length >= 3 && s.endsWith(suffix)) return s.slice(0, -suffix.length);
  }
  return s;
}

/**
 * Every stem a token could plausibly be: itself, plus the result of removing each suffix that
 * matches. Generating all of them rather than picking one removes the guess — "kasunge" yields
 * both "kasunge" and "kasun", and a match on any of them is a match.
 */
function stems(normalised) {
  const out = new Set([normalised]);
  for (const suffix of SUFFIXES) {
    if (normalised.length - suffix.length >= 3 && normalised.endsWith(suffix)) {
      out.add(normalised.slice(0, -suffix.length));
    }
  }
  return out;
}

/**
 * Canonical key for a name, in any of the four input languages or any script mixture.
 * Returns '' for input that holds no letters, which callers must treat as "no match", never as
 * a wildcard that matches everything.
 */
/** Normalise to a comparable Latin form. No suffix stripping — `stems()` owns that. */
function normalise(input) {
  if (typeof input !== 'string') return '';

  // NFKC folds full-width forms, ligatures and compatibility characters into their plain shapes.
  let s = input.normalize('NFKC');

  s = [...s].map((ch) => HOMOGLYPHS.get(ch) ?? ch).join('');

  if (SINHALA.test(s)) {
    s = transliterate(s, {
      consonants: SI_CONSONANTS, vowelSigns: SI_VOWEL_SIGNS,
      independent: SI_INDEPENDENT, virama: SI_VIRAMA,
    });
  }
  if (TAMIL.test(s)) {
    s = transliterate(s, {
      consonants: TA_CONSONANTS, vowelSigns: TA_VOWEL_SIGNS,
      independent: TA_INDEPENDENT, virama: TA_VIRAMA,
    });
  }

  s = s.toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')   // drop accents, now that scripts are Latin
    .replace(/[^a-z0-9]/g, '')                 // drop spaces, hyphens, punctuation
    .replace(/(.)+/g, '$1');                 // "aa" -> "a", "ll" -> "l"

  // A key with no letter is not a name. Without this, a bare number in a reply ("72") would be a
  // candidate key, and any roster entry that was mis-entered as digits would match marks text.
  return /[a-z]/.test(s) ? s : '';
}

/**
 * Fold look-alike characters to their Latin shapes, and nothing else.
 *
 * Exported for `policy-check/checks.mjs`, whose `flatten()` was NFKC + lowercase only — and **NFKC
 * does not fold Cyrillic**. One Cyrillic character therefore walked past three of layer 3's four
 * conditions (`х = 6.`, and the instruction-leak and write-claim phrases with a Cyrillic `о`),
 * while `docs/SUBMISSION-BEDROCK.md` claimed policyCheck did homoglyph normalisation and red-team
 * cases D3/D6 are exactly that shape. Found 2026-11-20 by the traceability audit.
 *
 * It is this map rather than a second one on purpose: a copy would drift, and the name check and
 * the phrase checks must agree about what a letter is.
 */
export function foldHomoglyphs(input) {
  if (typeof input !== 'string') return '';
  return [...input].map((ch) => HOMOGLYPHS.get(ch) ?? ch).join('');
}

/**
 * Canonical key for a name, in any of the four input languages or any script mixture.
 * Returns '' for input that holds no letters, which callers must treat as "no match", never as
 * a wildcard that matches everything.
 */
export function nameKey(input) {
  const s = normalise(input);
  return s ? stripSuffix(s) : '';
}

/** The consonant fold. Applied to an already-normalised stem. */
function fold(s) {
  if (!s) return '';
  // Digraphs first, or the single-letter rules below would break them apart.
  return s
    .replace(/th|dh/g, 't')
    .replace(/sh|ch|zh/g, 's')
    .replace(/ng/g, 'n')
    .replace(/ph/g, 'p')
    .replace(/[dt]/g, 't')
    .replace(/[kgq]/g, 'k')
    .replace(/[pbf]/g, 'p')
    .replace(/[vw]/g, 'v')
    .replace(/[jz]/g, 's')
    .replace(/[aeiou]/g, 'a')   // vowel quality is the least reliable thing across scripts
    .replace(/(.)+/g, '$1');
}

/**
 * Aggressively folded key, for blocking decisions only.
 * Merges the consonant distinctions that Sinhala, Tamil and Latin spellings of the same name
 * disagree about, so දිල්මි, தில்மி, "Dilmi" and "Thilmi" all land on one key.
 */
export function foldedKey(input) {
  return fold(nameKey(input));
}

/**
 * Every folded key a piece of text could stand for: the whole thing, each suffix-stripped stem,
 * and — for a multi-word name — each individual word.
 *
 * The last part is what makes a roster of full display names usable. The roster holds
 * "Dilmi Fernando"; the agent writes "Dilmi got 72". Without indexing the parts, that reply did
 * not match and policyCheck waved through the precise leak it exists to catch.
 */
export function keyVariants(input) {
  if (typeof input !== 'string') return new Set();

  const out = new Set();
  const add = (value) => {
    for (const stem of stems(value)) {
      const key = fold(stem);
      if (key) out.add(key);
    }
  };

  const whole = normalise(input);
  if (whole) add(whole);

  // Split on whitespace and punctuation BEFORE normalising, so "Dilmi Fernando" yields two parts.
  const parts = input.split(/[\s.,;:/\|()[\]{}"'‘’“”]+/u).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const n = normalise(part);
      // Two letters is an initial or noise, not a name worth matching on.
      if (n.length >= 3) add(n);
    }
  }

  return out;
}

/**
 * Do two names refer to the same person, as far as a blocking decision is concerned?
 * Empty inputs never match, so a reply containing no name cannot match a roster entry.
 */
export function namesMatch(a, b) {
  const va = keyVariants(a);
  if (va.size === 0) return false;
  for (const key of keyVariants(b)) if (va.has(key)) return true;
  return false;
}

/**
 * Scan free text for any of a set of names. Used by policyCheck to find a student who should not
 * have been mentioned. Splits on anything that is not a letter in any of the four scripts, so it
 * catches a name embedded in Sinhala or Tamil prose.
 *
 * Returns the matching entries from `names`, not from the text, so a caller never echoes
 * attacker-supplied spelling back into a log or a reply.
 *
 * `skip` holds lowercase ordinary words that may never *be* a name on their own. It exists because
 * `foldedKey` is vowel-blind — which is what defeats "Dіlmі" with a Cyrillic i — and vowel-blind
 * matching makes a few real English words collide with real surnames: "Solve" folds onto Silva.
 * The caller supplies the list, because which words are ordinary prose is a policy question and
 * this module only answers what spellings of a name are equivalent.
 *
 * It is applied here rather than by blanking the words out of `text` first, and that is the whole
 * point: blanking removes a token from the stream, which makes its two neighbours adjacent, and
 * the pair rule below then concatenates a pair that never existed in the sentence. That mistake
 * was made once already and invented a leak out of a correct refusal.
 */
export function findNames(text, names, skip = new Set()) {
  if (typeof text !== 'string' || !text) return [];

  // One index entry per variant of each roster name, including each word of a full name.
  const wanted = new Map();
  for (const name of names) {
    for (const key of keyVariants(name)) {
      if (!wanted.has(key)) wanted.set(key, name);
    }
  }
  if (wanted.size === 0) return [];

  // Keep letters of all four scripts, AND combining marks: Sinhala vowel signs and the virama are
  // \p{M}, not \p{L}, so splitting on letters alone tears "දිල්මිගේ" into fragments and the name
  // is never found. That bug would have been a silent leak, so the \p{M} here is load-bearing.
  const tokens = text.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

  const ordinary = (token) => skip.has(token.toLowerCase());

  const hits = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const next = i + 1 < tokens.length ? tokens[i + 1] : null;

    // Check single tokens and adjacent pairs, since "Dil mi" and "දිල් මි" split across a space.
    // A pair is skipped when either half is an ordinary word: a name split across a space has two
    // name-shaped halves, so "ranking children" is a concatenation artefact and never a child.
    // This does not widen anything an attacker can already do — the pair rule only ever looked at
    // *adjacent* fragments, so "Dil x mi" with any word between them was never caught either.
    for (const candidate of [
      ordinary(tokens[i]) ? null : tokens[i],
      next && !ordinary(tokens[i]) && !ordinary(next) ? tokens[i] + next : null,
    ]) {
      if (!candidate) continue;
      for (const key of keyVariants(candidate)) {
        const found = wanted.get(key);
        if (found) { hits.add(found); break; }
      }
    }
  }
  return [...hits];
}
