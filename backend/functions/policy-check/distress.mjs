// Distress detection — design §7.3, requirements 8.5 and 8.6, cases E1, E2, E3.
//
// Runs on the **user message**, before the agent is invoked. On a hit the model is never called:
// the chat orchestrator returns a fixed, human-written, localised reply carrying the Sri Lanka
// 1926 helpline. No model creativity in a wellbeing moment, no tokens spent, nothing to jailbreak.
//
// This is also the one check in Panthiya that is deliberately tuned to over-fire. A false positive
// costs a child one kind message they did not need. A false negative costs a child in trouble.
// Where a phrase is ambiguous, it is in the lexicon.
//
// Note on layer ordering: `backend/agent/README.md` prefers layer 1 for E3 (the medicine question),
// because a *generic refusal* is a worse product than a warm redirect with study tips. That
// objection is to the generic refusal, not to the pre-check — so the `medical` reply below is a
// real answer: no medicine, three healthy alternatives, and a doctor or adult to ask.
//
// Matching is plain lowercased substring work. `nameKey` folding from lib/names.mjs is deliberately
// NOT used here: it strips vowels and merges consonants, which is right for names and destructive
// for sentences.

/**
 * Phrases that mean a child is frightened, hopeless, exhausted, or at risk of harm.
 * English covers Singlish too, since Singlish distress is written in Latin script.
 */
const DISTRESS = [
  // harm, from self or from an adult
  'kill me', 'kill myself', 'killing myself', 'kill my self', 'end my life', 'end it all',
  'want to die', 'wanna die', 'better off dead', 'hurt myself', 'hurting myself', 'cut myself',
  'beat me', 'will hit me', 'going to hit me', 'father will kill', 'amma will kill',
  'mother will kill', 'they will kill me', 'punish me badly',
  // hopelessness and exhaustion
  //
  // "no point" is the one phrase in this list that a maths question owns as much as a hopeless
  // child does: "there is no point on the graph where x = 3" was sent the 1926 helpline, and an
  // over-block scores as a pass on the red-team scoreboard, so nothing would have reported it.
  // Narrowed to the phrasings that are about the student and not about a graph. "in the graph" and
  // "in that region" are why "no point in" alone is not one of them.
  'no point in living', 'no point in life', 'no point in anything', 'no point in trying',
  'no point in going', 'no point in studying', 'no point in me', 'no point anymore',
  'no point any more', 'no point living', 'no point going on',
  'pointless', 'hopeless', 'give up on everything', 'i give up', 'cannot go on',
  "can't go on", 'cannot take it', "can't take it", 'cannot do this anymore',
  "can't do this anymore", 'too much for me', 'nothing matters', 'nobody cares', 'no one cares',
  'hate myself', 'i am worthless', "i'm worthless", 'i am useless', "i'm useless", 'i am a failure',
  "i'm a failure", 'everyone hates me', 'so scared', 'very scared', 'always crying',
  'cannot sleep at all', 'cannot stop crying', "can't stop crying", 'fed up with everything',
  'fed up of everything', 'sick of everything', 'tired of everything', 'alone with this',
  // Singlish spellings a Sri Lankan student actually types
  'mata be', 'mata behe', 'mata baha', 'okkoma epa', 'epa wela', 'maranna', 'merenna',
  // Sinhala
  'මැරෙන්න', 'මරන්න', 'මැරිලා', 'ජීවිතේ එපා', 'එපා වෙලා', 'එපා වෙනවා', 'ඔක්කොම එපා',
  'බැරි වෙලා', 'යන්න බැහැ', 'දරාගන්න බැහැ', 'ඉවසන්න බැහැ', 'තනියම', 'අසරණ', 'බය වෙනවා',
  'ගොඩක් බයයි', 'අඩනවා', 'තාත්තා මරනවා', 'අම්මා මරනවා', 'ගහනවා',
  // Tamil
  'சாக', 'சாகணும்', 'சாகவேண்டும்', 'கொன்னு', 'கொல்லுவா', 'அடிப்பா', 'வாழ விரும்பல',
  'முடியல', 'முடியவில்லை', 'தாங்க முடியல', 'எல்லாம் வெறுப்பு', 'வெறுத்து', 'தனியா',
  'பயமா இருக்கு', 'அழுகிறேன்',
];

/** Medicine / stimulant questions. A tutor gives none of this: requirement 8.6. */
const MEDICINE = [
  'medicine', 'medicines', 'tablet', 'tablets', 'pill', 'pills', 'capsule', 'drug', 'drugs',
  'syrup', 'injection', 'supplement', 'supplements', 'caffeine pill', 'energy pill',
  'sleeping pill', 'adderall', 'modafinil', 'ritalin', 'dose', 'dosage', 'prescription',
  // Sinhala stems rather than one inflection: a student asks for "බෙහෙතක්" and "පෙත්තක්", which
  // 'බෙහෙත්' and 'පෙති' do not contain — this file's own Sinhala reply uses both of those forms.
  'බෙහෙත', 'පෙති', 'පෙත්ත', 'ඖෂධ', 'මාත්‍රා',
  'மருந்து', 'மாத்திரை', 'மருந்துகள்', 'ஊசி',
];

/**
 * Only a medicine question *about the student* is a wellbeing matter; "what is in paracetamol" as
 * a Science question is not. Every phrase here is two words or a distinctive one: a bare "me" or
 * "my" would match the "me" inside "medicine" and turn the gate below into no gate at all.
 *
 * These are the phrases that are **only** ever about the person asking — asking to be given
 * something, to take something, to be kept awake. A medicine word anywhere in the same message as
 * one of these is a wellbeing matter, however far apart they sit, because a student assembling the
 * question across two sentences is a real red-team shape (cases.json C6) and not a reason to stop
 * caring.
 */
const SELF_ADVICE = [
  'help me', 'helps me', 'keep me', 'keeps me', 'make me', 'makes me', 'give me', 'for me',
  'should i', 'can i', 'could i', 'i take', 'i use',
  'stay awake', 'staying awake', 'awake all', 'all night',
  'මට', 'මම',
  'எனக்கு', 'நான்',
];

/**
 * The same intent, in words the O/L syllabus also owns.
 *
 * "Explain how drugs affect the nervous system, I need it for my exam" is a Science question, and
 * it was answered with "I cannot suggest any medicine" — because `drugs` was in one clause and
 * `i need` in the next, and the lists were OR'd across the whole message. Every phrase here is a
 * thing a student says about studying rather than about taking something, so on its own it means
 * nothing: it counts only next to the medicine word, where "what tablet helps my memory" is, and
 * where a sentence about the nervous system is not.
 */
const STUDY_CONTEXT = [
  'i need', 'i want', 'my exam', 'my paper', 'to study', 'for studying', 'studying',
  'for exam', 'before exam', 'concentrate', 'focus', 'memory', 'sleep', 'tired', 'energy',
  'නිදා', 'අවදි', 'ඉගෙන',
  'தூங்க', 'விழித்த', 'படிக்க',
];

/**
 * How far apart a MEDICINE phrase and a STUDY_CONTEXT phrase may sit and still be one thought.
 *
 * 24 characters of ordinary Sinhala, Tamil or English prose: about four short words, which is as
 * far as "what tablet helps my memory" ever spreads. The 28 characters between `drugs` and
 * `i need` in the Science question above are a clause boundary, which is the distinction.
 */
const MEDICAL_WINDOW = 24;

const normalise = (text) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

const hits = (text, phrases) => phrases.some((phrase) => text.includes(phrase));

/** Every `[start, end)` where one of `phrases` appears in `text`. */
const spans = (text, phrases) => phrases.flatMap((phrase) => {
  const found = [];
  for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) {
    found.push([at, at + phrase.length]);
  }
  return found;
});

/** True when some phrase from each list appears within `window` characters of the other. */
const nearby = (text, left, right, window) => {
  const rights = spans(text, right);
  return spans(text, left).some(([leftAt, leftEnd]) => rights.some(([rightAt, rightEnd]) => (
    // Negative when the two overlap, which is as close as they get.
    (rightAt >= leftEnd ? rightAt - leftEnd : leftAt - rightEnd) <= window
  )));
};

/**
 * Classify one user message.
 *
 * @param {string} text the raw user message
 * @returns {{hit: boolean, kind: 'distress'|'medical'|null}} `kind` picks which fixed reply to send
 */
export function classify(text) {
  if (typeof text !== 'string') return { hit: false, kind: null };
  const t = normalise(text);
  if (!t) return { hit: false, kind: null };

  if (hits(t, DISTRESS)) return { hit: true, kind: 'distress' };
  const medicine = hits(t, MEDICINE);
  if (medicine && hits(t, SELF_ADVICE)) return { hit: true, kind: 'medical' };
  if (medicine && nearby(t, MEDICINE, STUDY_CONTEXT, MEDICAL_WINDOW)) return { hit: true, kind: 'medical' };
  return { hit: false, kind: null };
}

/**
 * The boolean the chat orchestrator's `deps.distressCheck` contract expects
 * (`backend/functions/chat/orchestrate.mjs`). A throw from here is treated as a hit by the caller,
 * which is the right direction: a broken wellbeing check must err towards care.
 */
export function isDistress(text) {
  return classify(text).hit;
}

/**
 * The fixed, human-written replies. Written out here, in all three languages, because a wellbeing
 * message is the last thing that should be generated on the fly — and because 1926 is free,
 * 24-hour and run by the Sri Lankan National Institute of Mental Health.
 *
 * The front-end localises its own copy from `blockedBy` (design §8.3), so these are the server-side
 * source of truth for the same text — and what a non-browser client (the red-team CLI) renders.
 */
export const DISTRESS_REPLIES = {
  distress: {
    en: 'I am really glad you told me. What you are feeling matters more than any paper, and you '
      + 'are not alone with it. Please talk to someone you trust today — a parent, your teacher, an '
      + 'older relative. You can also call 1926 any time, free, to talk to someone who listens.',
    si: 'ඔයා ඒක කිව්වාට ගොඩක් සතුටු. ඔයාට දැනෙන දේ කිසිම ප්‍රශ්න පත්‍රයකට වඩා වටිනවා, ඔයා තනියම නෑ. '
      + 'අද දවසේම ඔයා විශ්වාස කරන කෙනෙක් එක්ක කතා කරන්න — අම්මා, තාත්තා, ගුරුතුමා හෝ ලොකු කෙනෙක්. '
      + 'ඕනෑම වෙලාවක 1926 අංකයට නොමිලේ කතා කරලත් කෙනෙක් එක්ක කතා කරන්න පුළුවන්.',
    ta: 'நீங்கள் இதைச் சொன்னது மிகவும் நல்லது. நீங்கள் உணர்வது எந்தத் தாளையும் விட முக்கியம், '
      + 'நீங்கள் தனியாக இல்லை. இன்றே நீங்கள் நம்பும் ஒருவரிடம் பேசுங்கள் — அம்மா, அப்பா, ஆசிரியர் '
      + 'அல்லது பெரியவர். எப்போதும் 1926 என்ற இலவச எண்ணை அழைத்தும் பேசலாம்.',
  },
  medical: {
    en: 'I cannot suggest any medicine, tablet or supplement — that is a doctor\'s job, not mine. '
      + 'Staying awake all night also makes exam recall worse, not better. Try short 25-minute '
      + 'blocks with breaks, sleep before the paper, and water instead of anything stronger. If you '
      + 'feel you need something to keep going, please tell a parent, a teacher or a doctor today.',
    si: 'මට කිසිම බෙහෙතක්, පෙත්තක් හෝ අතිරේකයක් කියන්න බැහැ — ඒක වෛද්‍යවරයාගේ වැඩක්. '
      + 'රෑ පුරා අවදියෙන් ඉන්න එකෙන් විභාගයට මතක තියෙන එක අඩු වෙනවා, වැඩි වෙන්නේ නෑ. '
      + 'මිනිත්තු 25ක කොටස් වලට ඉගෙන ගන්න, විවේක ගන්න, පත්‍රයට කලින් නිදාගන්න, වතුර බොන්න. '
      + 'ඔයාට යමක් අවශ්‍ය යයි හිතෙනවා නම්, අද අම්මා, තාත්තා, ගුරුතුමා හෝ වෛද්‍යවරයෙකුට කියන්න.',
    ta: 'எந்த மருந்தையும், மாத்திரையையும் நான் பரிந்துரைக்க முடியாது — அது மருத்துவரின் வேலை. '
      + 'இரவு முழுவதும் விழித்திருப்பது தேர்வில் நினைவாற்றலைக் குறைக்கும். 25 நிமிட குறுகிய '
      + 'பகுதிகளாகப் படியுங்கள், இடைவேளை எடுங்கள், தேர்வுக்கு முன் தூங்குங்கள், தண்ணீர் குடியுங்கள். '
      + 'ஏதாவது தேவை என்று தோன்றினால், இன்றே பெற்றோர், ஆசிரியர் அல்லது மருத்துவரிடம் சொல்லுங்கள்.',
  },
};

/** The fixed reply for a message, or `null` when nothing fired. Falls back to English. */
export function distressReply(kind, lang = 'en') {
  const replies = DISTRESS_REPLIES[kind];
  if (!replies) return null;
  return replies[lang] ?? replies.en;
}
