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
 */
// Longest first: Tamil "யின்" must be stripped as "yin", not clipped to "in" and left as "…y".
const SUFFIXES = ['nge', 'gen', 'yin', 'ine', 'tta', 'ge', 'ta', 'wa', 'va', 'in', 'ku', 'ai', 's']
  .sort((a, b) => b.length - a.length);

function stripSuffix(s) {
  for (const suffix of SUFFIXES) {
    if (s.length - suffix.length >= 3 && s.endsWith(suffix)) return s.slice(0, -suffix.length);
  }
  return s;
}

/**
 * Canonical key for a name, in any of the four input languages or any script mixture.
 * Returns '' for input that holds no letters, which callers must treat as "no match", never as
 * a wildcard that matches everything.
 */
export function nameKey(input) {
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
    .replace(/(.)\1+/g, '$1');                 // "aa" -> "a", "ll" -> "l"

  // A key with no letter is not a name. Without this, a bare number in a reply ("72") would be a
  // candidate key, and any roster entry that was mis-entered as digits would match marks text.
  if (!/[a-z]/.test(s)) return '';

  return stripSuffix(s);
}

/**
 * Aggressively folded key, for blocking decisions only.
 * Merges the consonant distinctions that Sinhala, Tamil and Latin spellings of the same name
 * disagree about, so දිල්මි, தில்மி, "Dilmi" and "Thilmi" all land on one key.
 */
export function foldedKey(input) {
  let s = nameKey(input);
  if (!s) return '';

  // Digraphs first, or the single-letter rules below would break them apart.
  s = s
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
    .replace(/(.)\1+/g, '$1');

  return s;
}

/**
 * Do two names refer to the same person, as far as a blocking decision is concerned?
 * Empty keys never match, so a reply containing no name cannot match a roster entry.
 */
export function namesMatch(a, b) {
  const ka = foldedKey(a);
  return ka !== '' && ka === foldedKey(b);
}

/**
 * Scan free text for any of a set of names. Used by policyCheck to find a student who should not
 * have been mentioned. Splits on anything that is not a letter in any of the four scripts, so it
 * catches a name embedded in Sinhala or Tamil prose.
 *
 * Returns the matching entries from `names`, not from the text, so a caller never echoes
 * attacker-supplied spelling back into a log or a reply.
 */
export function findNames(text, names) {
  if (typeof text !== 'string' || !text) return [];

  const wanted = new Map();
  for (const name of names) {
    const key = foldedKey(name);
    if (key) wanted.set(key, name);
  }
  if (wanted.size === 0) return [];

  // Keep letters of all four scripts, AND combining marks: Sinhala vowel signs and the virama are
  // \p{M}, not \p{L}, so splitting on letters alone tears "දිල්මිගේ" into fragments and the name
  // is never found. That bug would have been a silent leak, so the \p{M} here is load-bearing.
  const tokens = text.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

  const hits = new Set();
  for (let i = 0; i < tokens.length; i++) {
    // Check single tokens and adjacent pairs, since "Dil mi" and "දිල් මි" split across a space.
    for (const candidate of [tokens[i], i + 1 < tokens.length ? tokens[i] + tokens[i + 1] : null]) {
      if (!candidate) continue;
      const found = wanted.get(foldedKey(candidate));
      if (found) hits.add(found);
    }
  }
  return [...hits];
}
