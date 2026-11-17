// getHint and getSimilarExample — the two actions a student session can reach, and the only two
// the tutor needs.
//
// This is the one action group in Panthiya with **no `deps` parameter**, no `resolveScope` call and
// no `assertInScope` call. That is not an omission, it is the design (§3.3): the tutor needs no
// stored data, so it is given none. There is no DynamoDB client in this file, no table name, and
// the Lambda's IAM role carries no DynamoDB permission at all. "Sir said I can see the marks
// sheet" (case A5) and "change my November fee" (case B4) are therefore not refused by a rule —
// the code and the credentials that would answer them do not exist.
//
// What is left to get right is the tutoring rule, and it is a *content* rule rather than an
// access one: requirement 8.3 says the final answer to the asked question must never come out.
// Two structural choices carry that here:
//
// 1. **This file cannot solve anything.** Every hint and every worked example below is fixed text
//    chosen by pattern, not generated. A handler that computed an answer in order to withhold it
//    would be one formatting mistake away from printing it.
// 2. **A worked example is verified against the question before it is returned** — using the same
//    `numberTokens` tokeniser that defence layer 3 uses, imported rather than copied. If the two
//    used different tokenisers, the handler could pass an example that layer 3 then blocks, and
//    the demo would look broken instead of safe (case C8, design §7.2).
//
// Cross-function import note: `chat/index.mjs` already imports `policy-check/distress.mjs` the same
// way, and every function's `CodeUri` is the backend root, so this resolves in Lambda too. Both
// imported modules are pure — neither touches DynamoDB — so importing them does not weaken the
// no-data-access property above.

import { sessionAttributes, requireRole } from '../../lib/auth.mjs';
import { numberTokens } from '../policy-check/checks.mjs';
import { classify } from '../policy-check/distress.mjs';

/** Trim and cap a model-supplied string. Unbounded text is a cost and an injection surface. */
function text(value, max = 1200) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * What the model supplied, as a plain object. Untrusted input by definition (design §3.1).
 *
 * Here it is untrusted in a narrower sense than in the other groups: nothing in it is ever used as
 * a key, an identifier or a scope, because this group reads nothing. It is used only to *choose*
 * fixed text, and its numbers are used to reject an example.
 */
export function modelParams(event) {
  return Object.fromEntries((event?.parameters ?? []).map((p) => [p.name, p.value]));
}

// --- the scaffolding table ---------------------------------------------------------------------
//
// Ordered: the first `match` that fires wins, so the specific kinds come before the general ones.
// `match` runs on the student's question text in whatever script it arrives in; the Sinhala and
// Tamil keywords are there so a question written in those languages still lands on its kind.
//
// None of the hint text contains a digit, and none of it contains a number word in a result
// position ("is six", "= 6"). That is deliberate: layer 3 reads everything outside an
// [[EXAMPLE]] wrapper strictly, and scaffolding that tripped it would block a reply that was
// never an answer. `tests/unit/actions-student.test.mjs` asserts this for every kind.
//
// ponytail: six recognised kinds plus a general fallback, covering the O/L Maths, Science and ICT
// shapes requirement 8.1 names. Ceiling: an unrecognised question gets the general scaffold, which
// is honest but less useful, and gets no worked example at all. Add a kind when the live runs show
// one is missing — not before.
const SCAFFOLDS = [
  {
    kind: 'quadratic',
    match: /x\s*(?:²|\^\s*2|\*\*\s*2)|\b[a-z]\s*squared\b|quadratic|වර්ග\s*සමීකරණ|இருபடி/i,
    concept: 'A quadratic has the unknown multiplied by itself, so it is solved by making one side '
      + 'zero and then factorising — not by moving terms across one at a time.',
    nextStep: 'Bring every term to the same side so the other side is zero, then look for a pair '
      + 'of numbers whose product is the constant term and whose sum is the middle coefficient.',
    guidingQuestion: 'Once one side is zero, which pair of factors multiplies to give the constant '
      + 'term and adds to give the middle one?',
    selfCheck: 'Substitute each root back into the original equation yourself and see whether both '
      + 'sides balance. A quadratic usually has two roots, so check them both.',
    examples: [
      {
        exampleProblem: 'Solve a^2 - 9a + 14 = 0.',
        exampleWorking: 'Look for two numbers that multiply to 14 and add to -9: they are -7 and '
          + '-2. So the equation factorises as (a - 7)(a - 2) = 0, which means a = 7 or a = 2. '
          + 'Checking a = 7: 49 - 63 + 14 comes to zero, so that root holds.',
        transferHint: 'Find the matching factor pair for your own constant and middle term, then '
          + 'set each bracket to zero in turn.',
      },
      {
        exampleProblem: 'Solve m^2 + 15m + 36 = 0.',
        exampleWorking: 'Two numbers multiply to 36 and add to 15: they are 12 and 3. So '
          + '(m + 12)(m + 3) = 0, which means m = -12 or m = -3. Checking m = -3: 9 - 45 + 36 '
          + 'comes to zero, so that root holds.',
        transferHint: 'Do the same hunt for a factor pair on your own equation, then read each '
          + 'root off its bracket.',
      },
    ],
  },
  {
    kind: 'speed-distance-time',
    match: /\b(speed|velocity|km\s*\/?\s*h|kmph|m\s*\/\s*s|distance|travels?|travelled|journey|train|bus|cyclist)\b|වේග|දුර\s*ප්‍රමාණ|ගමන්|வேக|தூர/i,
    concept: 'Speed, distance and time are a single relationship: distance is speed multiplied by '
      + 'time. Either of the other two comes from rearranging that same line.',
    nextStep: 'Write down which two of the three the question gives you and which one it asks '
      + 'for, then put every time into the same unit before you touch the figures.',
    guidingQuestion: 'How long does the journey last when you count it in hours, and which of the '
      + 'three quantities is the question actually asking for?',
    selfCheck: 'Put your own figure back into distance = speed x time and check the units agree '
      + 'with the question: kilometres with kilometres per hour, and hours with hours.',
    examples: [
      {
        exampleProblem: 'A bus leaves at 7.00 a.m., travels at 45 km/h, and arrives at 11.00 a.m. '
          + 'How far did it go?',
        exampleWorking: 'From 7.00 a.m. to 11.00 a.m. is 4 hours. Distance is speed multiplied by '
          + 'time, so 45 x 4 gives 180 km. Checking the units: km/h multiplied by h leaves km.',
        transferHint: 'Work out your own journey time first, in hours, then multiply by the speed '
          + 'the question gives you.',
      },
      {
        exampleProblem: 'A cyclist covers 72 km at a steady 24 km/h. How long does the ride take?',
        exampleWorking: 'Rearranging distance = speed x time gives time = distance divided by '
          + 'speed, so 72 divided by 24 leaves 3 hours. Checking: 24 x 3 returns the 72 km the '
          + 'question started from.',
        transferHint: 'Rearrange the same relationship for whichever quantity your question is '
          + 'missing, then divide rather than multiply.',
      },
    ],
  },
  {
    kind: 'percentage',
    match: /%|\bpercent|\bpercentage|\bprofit\b|\bloss\b|\bdiscount|\binterest\b|\bmarked price|සියයට|ලාභ|ලාභය|விழுக்காடு|இலாப/i,
    concept: 'Every percentage question is a comparison with a whole. The work is deciding which '
      + 'figure is the whole before any multiplying starts.',
    nextStep: 'Name the whole the percentage is taken of — the cost price, the marked price, the '
      + 'original amount — then write the percentage as a fraction of a hundred and multiply.',
    guidingQuestion: 'Which figure in your question is the whole that the percentage is measured '
      + 'against, and is the change an increase or a decrease?',
    selfCheck: 'Check your own figure for size rather than for a match: a discount must leave '
      + 'less than you started with, and a profit must leave more. If it does not, the wrong '
      + 'figure was used as the whole.',
    examples: [
      {
        exampleProblem: 'A shirt costs Rs. 2400 and is sold at a discount of 15%. What is the '
          + 'selling price?',
        exampleWorking: 'The whole here is the marked price, Rs. 2400. A discount of 15% of it is '
          + '2400 x 15 / 100, which leaves Rs. 360 off. Taking that away from 2400 leaves '
          + 'Rs. 2040, and that is less than the marked price, as a discount must be.',
        transferHint: 'Identify your own whole first, take the percentage of that, and only then '
          + 'add it on or take it away.',
      },
      {
        exampleProblem: 'A trader buys a bicycle for Rs. 18000 and sells it for Rs. 21600. What is '
          + 'the profit percentage?',
        exampleWorking: 'Profit percentage is always measured against the cost price, so the whole '
          + 'is Rs. 18000. The profit itself is 21600 - 18000, which leaves Rs. 3600. As a '
          + 'percentage of the whole that is 3600 / 18000 x 100, which comes to 20 per cent.',
        transferHint: 'Work out the actual gain or loss in rupees first, then compare it with the '
          + 'cost price rather than with the selling price.',
      },
    ],
  },
  {
    kind: 'geometry',
    match: /\barea\b|\bperimeter\b|\bvolume\b|\bradius\b|\bdiameter\b|\bcircumference\b|\btriangle\b|\brectangle\b|\bsquare\b|\bcircle\b|\bcylinder\b|ක්ෂේත්‍රඵල|පරිමා|පරිමිති|පරිමිතිය|முக்கோண|பரப்ப|சுற்றளவு/i,
    concept: 'Area, perimeter and volume are three different measurements of the same shape, and '
      + 'each has its own unit. Picking the right one is most of the question.',
    nextStep: 'Sketch the shape, label every length the question gives you, and decide whether it '
      + 'is asking for a distance around it, a surface across it, or a space inside it.',
    guidingQuestion: 'Which measurement does the question want — around the shape, across it, or '
      + 'inside it — and which lengths do you still need before you can work it out?',
    selfCheck: 'Check your own unit: a perimeter comes out in centimetres, an area in square '
      + 'centimetres, a volume in cubic centimetres. A wrong unit means the wrong formula.',
    examples: [
      {
        exampleProblem: 'A rectangle is 13 cm long and 6 cm wide. Find its area and its perimeter.',
        exampleWorking: 'Area is length multiplied by width: 13 x 6 leaves 78 square centimetres. '
          + 'The perimeter adds every side: 13 + 6 + 13 + 6 leaves 38 centimetres. Notice the two '
          + 'units are different, which is what tells you they are different measurements.',
        transferHint: 'Label your own sketch the same way, then choose the formula that matches '
          + 'the measurement your question names.',
      },
      {
        exampleProblem: 'A circle has a radius of 14 cm. Find its circumference, taking pi as 22/7.',
        exampleWorking: 'Circumference is twice pi multiplied by the radius: 2 x 22 / 7 x 14 '
          + 'leaves 88 centimetres. The unit is centimetres, not square centimetres, because this '
          + 'is a distance around the shape rather than a surface.',
        transferHint: 'Write down whether your own question gives the radius or the diameter '
          + 'before you substitute, because one is twice the other.',
      },
    ],
  },
  {
    kind: 'electricity',
    match: /\bohm|\bvoltage\b|\bvolts?\b|\bcurrent\b|\bresistance\b|\bampere|\bamps?\b|\bcircuit\b|\bresistor|විද්‍යුත්|ධාරා|ප්‍රතිරෝධ|மின்ன|மின்சார|மின்னோட்ட/i,
    concept: 'Voltage, current and resistance are tied together by Ohm\'s law: voltage is current '
      + 'multiplied by resistance. Series and parallel decide which figures you may add.',
    nextStep: 'Redraw the circuit, mark which components are in series and which are in parallel, '
      + 'and reduce it to a single resistance before using Ohm\'s law.',
    guidingQuestion: 'Are the components in your circuit in series or in parallel, and which of '
      + 'the three quantities does the question leave out?',
    selfCheck: 'Check your own figure against the circuit: in series the total resistance must be '
      + 'larger than any single resistor, and in parallel it must be smaller than the smallest. '
      + 'If yours is not, the wrong rule was applied.',
    examples: [
      {
        exampleProblem: 'A 12 V battery drives a current through a 48 ohm resistor. Find the '
          + 'current.',
        exampleWorking: 'Ohm\'s law rearranges to current = voltage divided by resistance, so 12 '
          + 'divided by 48 leaves 0.25 amperes. Checking by multiplying back: 0.25 x 48 returns '
          + 'the 12 V the question started from.',
        transferHint: 'Rearrange the same law for whichever of the three quantities your own '
          + 'question is missing.',
      },
      {
        exampleProblem: 'Two resistors of 30 ohms and 20 ohms are joined in parallel. Find the '
          + 'combined resistance.',
        exampleWorking: 'For a parallel pair the reciprocals add: 1/30 + 1/20 leaves 1/12, so the '
          + 'combined resistance is 12 ohms. That is smaller than either resistor, which is the '
          + 'check that the parallel rule was used and not the series one.',
        transferHint: 'Decide first whether your own pair is in series or parallel, then add the '
          + 'resistances or their reciprocals accordingly.',
      },
    ],
  },
  {
    kind: 'number-base',
    match: /\bbinary\b|\bdenary\b|\bdecimal\b|\bhexadecimal\b|\bhex\b|\boctal\b|\bbase\s*\d|\bbits?\b|\bbytes?\b|ද්විමය|இரும|பதினறும/i,
    concept: 'Converting between bases is place value. Each column is the base multiplied by the '
      + 'column to its right, and conversion is reading those columns in the other direction.',
    nextStep: 'Write the place values of the base you are leaving as a row of column headings, '
      + 'then fill the digits underneath them before adding anything up.',
    guidingQuestion: 'What are the place values of the columns in the base you are converting '
      + 'from, and which of them does your number actually fill?',
    selfCheck: 'Convert your own result straight back into the base you started from and see '
      + 'whether you land on the number in the question. If not, a column was missed.',
    examples: [
      {
        exampleProblem: 'Convert the binary number 110110 to denary.',
        exampleWorking: 'The column headings from the left are 32, 16, 8, 4, 2 and 1. The digits '
          + 'fill the 32, 16, 4 and 2 columns, so adding those headings gives 54. Converting back '
          + 'splits 54 into 32 + 16 + 4 + 2, which rebuilds the same digits.',
        transferHint: 'Write out the column headings for your own number first; the conversion is '
          + 'then only an addition.',
      },
      {
        exampleProblem: 'Convert the denary number 200 to hexadecimal.',
        exampleWorking: 'Dividing 200 by 16 leaves 12 with a remainder of 8. Twelve is written as '
          + 'C in hexadecimal, so the number is C8. Converting back, C is twelve, and twelve '
          + 'multiplied by 16 plus 8 returns 200.',
        // Line break placed mid-phrase on purpose: a string line ending in "from " followed by a
        // quote is what `tests/unit/packaging.test.mjs` scans for as an import specifier.
        transferHint: 'Divide your own number by the base repeatedly, then read the remainders '
          + 'backwards from the last one.',
      },
    ],
  },
  // Last of the recognised kinds on purpose: its pattern is the broadest here, and "solve" or an
  // equals sign appears in plenty of questions that belong to one of the kinds above. A question
  // about speed that happens to say "solve" must land on speed, not here.
  {
    kind: 'linear-equation',
    match: /\bsolve\b|\bequation\b|\bsimultaneous\b|\bunknown\b|=\s*-?\d|\b[a-z]\s*=|සමීකරණ|විසඳ|சமன்பாடு|தீர்/i,
    concept: 'An equation is a balance. Whatever you do to one side you must do to the other, and '
      + 'the aim is to leave the unknown by itself on one side.',
    nextStep: 'Take the constant term away from both sides first, then divide both sides by '
      + 'whatever is multiplying the unknown.',
    guidingQuestion: 'What is being added to the term carrying the unknown, and what happens to '
      + 'both sides when you take that away?',
    selfCheck: 'Substitute your own value back into the original equation and work out each side '
      + 'separately. If the two sides do not match, the step before is where to look.',
    examples: [
      {
        exampleProblem: 'Solve 4y - 7 = 29.',
        exampleWorking: 'Add 7 to both sides, which leaves 4y = 36. Then divide both sides by 4, '
          + 'giving y = 9. Checking by substitution: 4 times 9 is 36, and 36 - 7 comes to 29, so '
          + 'the equation balances.',
        transferHint: 'Take the same two steps on your own equation: clear the constant from the '
          + 'side with the unknown first, then divide.',
      },
      {
        exampleProblem: 'Solve 6m + 11 = 47.',
        exampleWorking: 'Take 11 from both sides, which leaves 6m = 36. Then divide both sides by '
          + '6, giving m = 6. Checking by substitution: 6 times 6 is 36, and 36 + 11 comes to 47.',
        transferHint: 'Clear the constant from your own equation first, then divide by whatever '
          + 'multiplies the unknown.',
      },
    ],
  },
];

/**
 * The scaffold for any question we do not recognise.
 *
 * It carries no worked example on purpose. An example for a question whose shape we could not
 * identify could not be verified as a *different* problem, and an unverified example is exactly
 * the thing requirement 8.2 exists to prevent.
 */
const GENERAL = {
  kind: 'general',
  concept: 'Most past-paper questions are asking you to notice which relationship or rule they '
    + 'are built on. Finding that is the step that unlocks the rest.',
  nextStep: 'Write out what the question gives you and what it asks for in two short lists, then '
    + 'name the rule from your syllabus that connects them.',
  guidingQuestion: 'What does the question hand you, what does it want, and which rule from your '
    + 'notes links those two?',
  selfCheck: 'Once you have worked it through, check your own result against the question rather '
    + 'than against me: substitute it back into the wording and see whether every condition the '
    + 'question states still holds.',
  examples: [],
};

/** The first scaffold whose pattern fires, or the general one. */
export function pickScaffold(questionText) {
  return SCAFFOLDS.find((s) => s.match.test(questionText)) ?? GENERAL;
}

// --- requirement 8.2: the example must be a different problem -----------------------------------

/**
 * Is this example safe to return for this question?
 *
 * Two conditions, and the first of them is the layer-3 rule verbatim (design §7.2: an example is
 * blocked when it repeats *every* number of the question, however many it adds):
 *
 * 1. **It omits at least one of the question's numbers** — so it can never be the asked problem
 *    with the answer appended, and so it can never be blocked by layer 3 either. The handler and
 *    layer 3 agreeing is the point: a check that was merely *similar* to layer 3's would let the
 *    handler return examples the student then never sees (case C8).
 * 2. **It introduces at least one number the question does not have** — so "different numbers" is
 *    a positive property rather than the absence of a collision.
 *
 * Testing for a subset rather than demanding full disjointness is deliberate. Structural figures
 * are shared by every question of a kind: every quadratic ends in zero, every circle question
 * carries a two and a seven inside 22/7. Demanding disjointness would reject every example for
 * those, and a student who gets no example learns less, for no gain in safety.
 */
export function differsNumerically(exampleNumbers, questionNumbers) {
  if (questionNumbers.size === 0) return exampleNumbers.length > 0;   // nothing to collide with
  const inExample = new Set(exampleNumbers);
  const omitsOne = [...questionNumbers].some((n) => !inExample.has(n));
  const addsOne = exampleNumbers.some((n) => !questionNumbers.has(n));
  return omitsOne && addsOne;
}

/** Every number in an example, counted over the whole of it — working and transfer hint included. */
const exampleNumbers = (ex) =>
  numberTokens([ex.exampleProblem, ex.exampleWorking, ex.transferHint].join(' '));

/**
 * The first candidate example that differs from the question, or `null`.
 *
 * ponytail: two candidates per kind, written out as data rather than generated, so every example
 * in this file can be read and checked by eye. Nothing here computes arithmetic — a handler that
 * calculated an example's answer in order to print it would be one bug away from calculating the
 * student's. Ceiling: a question colliding with both candidates of its kind gets no example and
 * falls back to a hint. Add a third candidate if the live runs show that firing.
 */
export function chooseExample(scaffold, questionNumbers) {
  for (const candidate of scaffold.examples) {
    if (differsNumerically(exampleNumbers(candidate), questionNumbers)) return candidate;
  }
  return null;
}

// --- the actions --------------------------------------------------------------------------------

/**
 * Requirements 8.5 and 8.6, as the second line of defence.
 *
 * Distress and medicine questions are caught on the user message *before* the agent is invoked
 * (design §7.3), so in the normal path they never reach this file. They can still arrive here:
 * the model is told to join a question split over several messages into `questionText`, and a
 * question split that way is exactly how the pre-check would be walked around (the shape of case
 * C6, pointed at case E3).
 *
 * So the same `classify` the pre-check uses runs again on the text this group was actually handed,
 * and on a hit nothing is returned — no hint, no example, and no medicine, dose or supplement,
 * because this file contains none to return.
 *
 * It over-fires in the same direction as the pre-check, for the same reason: a question about
 * medicine as chemistry costs one hint, and the student is told to ask a teacher. Missing a
 * frightened child costs more than that.
 */
function wellbeingHit(questionText) {
  const { hit, kind } = classify(questionText);
  return hit ? { ok: false, ask: 'wellbeing', kind } : null;
}

/** The subject, if the model named one we recognise. Presentational only — nothing branches on it. */
const SUBJECTS = new Set(['maths', 'science', 'ict', 'other']);
const subjectOf = (value) => {
  const given = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SUBJECTS.has(given) ? given : 'other';
};

/**
 * Socratic hint scaffolding for one question: the concept, the next step, a question that moves
 * the student forward, and how to check their own result (requirements 8.1, 8.3).
 *
 * Returns no answer, and cannot: every field is fixed text selected by pattern.
 *
 * @param event the Bedrock action-group invocation
 */
export async function getHint(event) {
  const { role } = sessionAttributes(event);   // identity, out of band, never from the message
  requireRole(role, 'student');                // first statement, before any logic

  const p = modelParams(event);
  const questionText = text(p.questionText);

  const wellbeing = wellbeingHit(questionText);
  if (wellbeing) return { ...wellbeing, action: 'getHint' };

  const scaffold = pickScaffold(questionText);

  return {
    ok: true,
    action: 'getHint',
    status: 'ok',
    kind: scaffold.kind,
    subject: subjectOf(p.subject),
    concept: scaffold.concept,
    nextStep: scaffold.nextStep,
    guidingQuestion: scaffold.guidingQuestion,
    selfCheck: scaffold.selfCheck,
    // Student-facing, in English; the model renders it in the student's own language (req 8.7).
    // The [[EXAMPLE]] rule is not repeated here — it already lives in the agent instruction and in
    // the action schema, and a third copy would be a third place to forget to change.
    message: 'Here is the concept and the next step to try. Work the step yourself and you will '
      + 'be most of the way there; ask again if the next part will not come.',
  };
}

/**
 * A worked example of a **different** problem with different numbers (requirement 8.2, case C8).
 *
 * The example is chosen, never built, and is returned only once it has been checked against the
 * question's own numbers. When no candidate differs, nothing is returned and the model is told to
 * hint instead — which is the right failure direction: a missing example costs a student some
 * help, and a same-numbers example hands over the answer.
 *
 * @param event the Bedrock action-group invocation
 */
export async function getSimilarExample(event) {
  const { role } = sessionAttributes(event);
  requireRole(role, 'student');

  const p = modelParams(event);
  const questionText = text(p.questionText);

  const wellbeing = wellbeingHit(questionText);
  if (wellbeing) return { ...wellbeing, action: 'getSimilarExample' };

  const scaffold = pickScaffold(questionText);
  const questionNumbers = new Set(numberTokens(questionText));
  const example = chooseExample(scaffold, questionNumbers);

  if (!example) return { ok: false, ask: 'no_safe_example', action: 'getSimilarExample' };

  return {
    ok: true,
    action: 'getSimilarExample',
    status: 'ok',
    kind: scaffold.kind,
    subject: subjectOf(p.subject),
    ...example,
    message: 'This is a different problem with different numbers from yours. Work through it, '
      + 'then try the same method on your own question.',
  };
}

/** The student row of the action table in design §6.2, as code. Two actions, and only two. */
export const ACTIONS = { getHint, getSimilarExample };
