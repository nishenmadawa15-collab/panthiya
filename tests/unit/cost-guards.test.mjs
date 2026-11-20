// The cost model, pinned to the template that produces it.
//
// design §10 is now costed for the Kiroween judging window (2026-12-16 → 2027-01-29), and the
// whole re-costing rests on one structural claim: **nothing in this stack bills per hour or per
// month regardless of traffic.** That claim is a property of backend/template.yaml, so it belongs
// in a test rather than in prose — a later lane adding a NAT gateway, provisioned capacity or a
// cluster would otherwise move the ten-week total by an order of magnitude with the suite green.
//
// It also pins the budget alert that §10 used to record as missing, including the one thing a
// public repo cannot afford to get wrong: the alert address is a parameter, never a literal.
//
// -----------------------------------------------------------------------------------------------
// REBUILT 2026-11-20, the same way the audit-log guard in tests/unit/env-contract.test.mjs was
// rebuilt on 2026-11-19, and deliberately not in a second style of its own. Two defects, one of
// each kind that guard names:
//
//   1. It read the template BY KEY NAME AND INDENTATION. `block()` found a resource with
//      `/^ {2}([A-Za-z0-9]+):[ ]*$/`, so a key carrying a trailing comment (`SpendBudget: # …`)
//      or a character outside `[A-Za-z0-9]` was not a resource as far as this file was concerned
//      — and its body was silently folded into whichever resource came before it.
//
//   2. Its assertions were EXISTENCE CHECKS, not absence-of-capability checks. "An ACTUAL
//      threshold exists", "`Address:` appears at least once", "the count of
//      `BillingMode: PAY_PER_REQUEST` equals the count of tables". Each of those is satisfiable
//      while the capability it stands for is gone: a notification with no subscribers at all
//      passes "`Address:` appears", and a *commented-out* `BillingMode` line is counted by a
//      regex that never stripped comments, so a table silently reverting to CloudFormation's
//      PROVISIONED default kept the totals balanced.
//
// So this one is inverted, exactly like the audit-log guard. It enumerates every resource in the
// template by POSITION — any key spelling, comments stripped — and requires that every single one
// be a type design §10 costed; that every DynamoDB table name on-demand billing in its own block;
// and that every budget notification name a subscriber of its own. A shape this parser cannot read
// is a failure, never a pass. That is the only version of this check that can go red on a resource
// nobody thought of in advance.
//
// There is no YAML parser to lean on: package.json has no dependencies by design and Node ships
// none. So the readers stay indentation-driven, and `uncomment` is the same function as in
// env-contract.test.mjs for the same reason.
//
// The last test in this file is the proof: it mutates the template in the three shapes above and
// asserts that the old assertions stayed green on each one while these go red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TEMPLATE = readFileSync(new URL('../../backend/template.yaml', import.meta.url), 'utf8');

// --- the reader ---------------------------------------------------------------------------------

/** A line with any trailing `#` comment removed. A quoted `#` (`"ts#ulid"`) is left alone. */
function uncomment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line;
}

const unquote = (value) => value.trim().replace(/^(["'])(.*)\1$/, '$2');

/**
 * Every two-space-indented entry of a top-level section, by **position**: name → its own lines,
 * comments stripped and original indentation kept.
 *
 * Found as "a key at column 2 inside the section", not as "a key whose name I recognise", so a
 * hyphen, a dot or a trailing comment changes nothing. A line at column 2 that is not a readable
 * block head is collected into `unreadable` and the callers turn that into a failure, so a shape
 * this function cannot parse can never be mistaken for an absent one.
 */
function entriesOf(text, sectionName) {
  const lines = text.split('\n').map(uncomment);
  const start = lines.indexOf(`${sectionName}:`);
  assert.ok(start >= 0, `template.yaml has no ${sectionName}: section`);

  const entries = new Map();
  const unreadable = [];
  const sectionLines = [];
  let current = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (/^\S/.test(line)) break;                        // column 0: the next top-level section
    sectionLines.push(line);
    if (/^ {2}\S/.test(line)) {
      const head = /^ {2}([^\s:][^:]*):$/.exec(line);
      if (!head) { unreadable.push(line.trim()); current = null; continue; }
      current = [];
      entries.set(head[1].trim(), current);
      continue;
    }
    current?.push(line);
  }
  return { entries, unreadable, sectionLines };
}

/** Every value of a scalar `key:` inside a block, at any depth, list item or not. */
const valuesOf = (lines, key) => lines.flatMap((line) => {
  const m = new RegExp(`^\\s*(?:-\\s+)?${key}:[ ]+(\\S.*)$`).exec(line);
  return m ? [unquote(m[1])] : [];
});

/** True when `key:` appears as a block key (a mapping or list header) inside these lines. */
const hasKey = (lines, key) => lines.some((line) => new RegExp(`^\\s*(?:-\\s+)?${key}:$`).test(line));

/**
 * The list items under a block key, each as its own lines — the same positional algorithm
 * `statementBlocks()` in env-contract.test.mjs uses for IAM statements, which is why a list item
 * is found by where it sits rather than by which key it happens to start with.
 */
function itemsUnder(lines, key) {
  const at = lines.findIndex((line) => new RegExp(`^\\s*${key}:$`).test(line));
  if (at === -1) return [];
  const owner = lines[at].indexOf(`${key}:`);

  const items = [];
  let item = null;
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue;
    if (line.search(/\S/) <= owner) break;              // dedented: out of this list
    const dash = /^([ ]*)-[ ]+(.*)$/.exec(line);
    if (dash && (item === null || dash[1].length === item.indent)) {
      item = { indent: dash[1].length, lines: [] };
      items.push(item);
      item.lines.push(`${' '.repeat(dash[1].length + 2)}${dash[2]}`);
      continue;
    }
    item?.lines.push(line);
  }
  return items.map((i) => i.lines);
}

/** A resource's own `Type:`, which sits at column 4 directly under the logical name. */
const typeKeys = (lines) => lines.flatMap((l) => {
  const m = /^ {4}Type:[ ]+(\S.*)$/.exec(l);
  return m ? [unquote(m[1])] : [];
});

/** Logical name → `{ type, lines }` for every resource, with the parser's own blind spots listed. */
function resourcesOf(text) {
  const { entries, unreadable, sectionLines } = entriesOf(text, 'Resources');
  const out = new Map();
  for (const [name, lines] of entries) {
    const types = typeKeys(lines);
    if (types.length !== 1) { unreadable.push(`${name}: ${types.length} readable Type: keys`); continue; }
    out.set(name, { type: types[0], lines });
  }
  // Every resource carries exactly one `Type:` at column 4, so these two totals must agree. They
  // stop agreeing the moment a key spelling slips past the reader above — which is the defect this
  // rebuild is about, so it is a counted sentinel rather than a hope.
  return { resources: out, unreadable, declared: typeKeys(sectionLines).length };
}

// --- what design §10 costed ---------------------------------------------------------------------

/**
 * The resource types the ten-week cost model is built on, and the only ones allowed in here.
 *
 * An allow-list, not a block-list, and that is the whole difference. The list this replaced named
 * thirteen things that bill while idle — and `AWS::Transfer::Server` (~US$0.30/hr, ~US$216/month,
 * fourteen times the entire project budget), `AWS::DocDB::DBCluster`, `AWS::EFS::FileSystem`,
 * `AWS::MemoryDB::Cluster` and `AWS::KinesisFirehose::DeliveryStream` are none of them. Every one
 * of those would have deployed with this suite green. Being unrecognised is now the failure, so
 * adding a resource type means re-costing design §10 and editing this line, in that order.
 *
 * Everything here bills per request, per stored byte or per monthly active user — i.e. nothing
 * while the app sits idle through ~1,700 hours of judging.
 */
const COSTS_NOTHING_IDLE = new Set([
  'AWS::Serverless::Function',      // per invocation + GB-second
  'AWS::Serverless::HttpApi',       // per request
  'AWS::Lambda::Permission',        // free
  'AWS::DynamoDB::Table',           // per request, but only on PAY_PER_REQUEST — asserted below
  'AWS::S3::Bucket',                // per stored byte, and voice/ expires after a day
  'AWS::Cognito::UserPool',         // per monthly active user
  'AWS::Cognito::UserPoolClient',   // free
  'AWS::Cognito::UserPoolDomain',   // free
  'AWS::Cognito::UserPoolGroup',    // free
  'AWS::Budgets::Budget',           // the first two budgets are free
]);

/**
 * Properties that switch a listed type over to hourly or provisioned billing. A second net under
 * the allow-list: `AWS::Serverless::Function` is free while idle *unless* it is given a VPC or
 * provisioned concurrency, and `AWS::DynamoDB::Table` is free while idle *unless* it is given
 * capacity, so the type alone is not the whole answer.
 *
 * Read off comment-stripped lines, which the regex scan this replaced was not: a `# VpcConfig:`
 * in a note used to fail it, and a commented-out `BillingMode` used to satisfy it.
 */
const IDLE_BILLING = [
  [/^\s*ProvisionedConcurrencyConfig:/, 'provisioned Lambda concurrency'],
  [/^\s*ProvisionedThroughput:/, 'provisioned DynamoDB capacity'],
  [/^\s*VpcConfig:/, 'a Lambda in a VPC, which needs a NAT gateway to reach AWS APIs'],
  [/^\s*BillingMode:[ ]+(?!PAY_PER_REQUEST\s*$)/, 'a DynamoDB table off on-demand billing'],
];

// ---------------------------------------------------------------------------
// 0. The reader reads this template. Two sentinels, so that a parser which
//    found nothing cannot sail through every assertion below.
// ---------------------------------------------------------------------------

test('the reader can account for every resource in the template', () => {
  const { resources, unreadable, declared } = resourcesOf(TEMPLATE);

  assert.deepEqual(unreadable, [],
    `every resource must be readable or design §10 is unenforced:\n  ${unreadable.join('\n  ')}`);
  assert.equal(resources.size, declared,
    `read ${resources.size} resources for ${declared} Type: keys — this guard is not reading the template`);
  assert.ok(resources.size >= 28, `only ${resources.size} resources — this is the wrong file`);
});

// ---------------------------------------------------------------------------
// 1. The structural claim the ten-week cost model rests on.
// ---------------------------------------------------------------------------

// Ten weeks of judging is ~1,700 idle hours, so one NAT gateway (~$0.045/hr) is more than twice
// the entire US$15 project budget on its own. design §10 has the arithmetic.

test('every resource in the template is a type design §10 costed as free while idle', () => {
  const { resources } = resourcesOf(TEMPLATE);

  const uncosted = [...resources]
    .filter(([, r]) => !COSTS_NOTHING_IDLE.has(r.type))
    .map(([name, r]) => `${name} is a ${r.type}`);

  assert.deepEqual(uncosted, [],
    `design §10 is costed on the claim that nothing here bills while idle. Re-cost it, then add the type to COSTS_NOTHING_IDLE:\n  ${uncosted.join('\n  ')}`);
});

test('no property switches a costed resource onto hourly or provisioned billing', () => {
  const lines = TEMPLATE.split('\n').map(uncomment);
  const found = IDLE_BILLING.flatMap(([pattern, what]) => lines
    .filter((line) => pattern.test(line))
    .map((line) => `${line.trim()} — ${what} — bills while idle`));

  assert.deepEqual(found, [],
    `design §10 is costed on the claim that nothing here does:\n  ${found.join('\n  ')}`);
});

test('every DynamoDB table names on-demand billing in its own block', () => {
  // Per table, not a count of matches against a count of tables. Those two totals balance just as
  // happily when one table has lost its `BillingMode` and a comment elsewhere supplies the match —
  // and CloudFormation's default for a missing `BillingMode` is PROVISIONED, billed by the hour.
  const { resources } = resourcesOf(TEMPLATE);
  const tables = [...resources].filter(([, r]) => r.type === 'AWS::DynamoDB::Table');
  assert.equal(tables.length, 8, 'design §4 has eight tables');

  const wrong = tables.flatMap(([name, r]) => {
    const modes = valuesOf(r.lines, 'BillingMode');
    if (modes.length !== 1) return [`${name} declares ${modes.length} BillingMode keys`];
    return modes[0] === 'PAY_PER_REQUEST' ? [] : [`${name} is on ${modes[0]}`];
  });

  assert.deepEqual(wrong, [],
    `a table without exactly one PAY_PER_REQUEST bills for capacity it is not using:\n  ${wrong.join('\n  ')}`);
});

// ---------------------------------------------------------------------------
// 2. The two deletion rules a judge could trip over. design §10 reads both as
//    cost/privacy guards that do NOT breach "available for testing" — but only
//    while they are the rules that were read. If either changes, that read has
//    to be redone, so they are pinned here.
// ---------------------------------------------------------------------------

test('redteam_runs is the only table with a TTL', () => {
  // Set equality, not a count: `TimeToLiveSpecification` appearing once says nothing about which
  // table carries it, and a TTL on a data table would delete demo data mid-judging.
  const { resources } = resourcesOf(TEMPLATE);
  const withTtl = [...resources]
    .filter(([, r]) => r.type === 'AWS::DynamoDB::Table' && hasKey(r.lines, 'TimeToLiveSpecification'))
    .map(([name]) => name);

  assert.deepEqual(withTtl, ['RedteamRunsTable'],
    'only the red-team runs table may expire its own rows');
});

test('voice notes still expire after one day, on the voice/ prefix only', () => {
  const { resources } = resourcesOf(TEMPLATE);
  const buckets = [...resources].filter(([, r]) => r.type === 'AWS::S3::Bucket');
  assert.equal(buckets.length, 1, 'design §10 costs one bucket');

  const rules = itemsUnder(buckets[0][1].lines, 'Rules');
  assert.equal(rules.length, 1, 'one lifecycle rule, so there is nothing to confuse it with');
  assert.deepEqual(valuesOf(rules[0], 'Status'), ['Enabled'], 'a disabled rule deletes nothing');
  assert.deepEqual(valuesOf(rules[0], 'Prefix'), ['voice/'],
    'scoped to voice/, so nothing else in the bucket is expired by it');
  assert.deepEqual(valuesOf(rules[0], 'ExpirationInDays'), ['1'],
    'one day is the figure design §10 costs the bucket on');
});

// ---------------------------------------------------------------------------
// 3. The budget alert exists, in the template rather than a console step, and
//    actually reaches someone.
// ---------------------------------------------------------------------------

/** The one budget, found by type rather than by the name it happens to have. */
function theBudget() {
  const { resources } = resourcesOf(TEMPLATE);
  const budgets = [...resources].filter(([, r]) => r.type === 'AWS::Budgets::Budget');
  assert.equal(budgets.length, 1,
    'design §10 requires one cost budget created by the deploy, not by hand afterwards');
  return budgets[0][1].lines;
}

test('the budget is a monthly COST budget in USD', () => {
  const budget = theBudget();
  assert.deepEqual(valuesOf(budget, 'BudgetType'), ['COST']);
  assert.deepEqual(valuesOf(budget, 'TimeUnit'), ['MONTHLY']);
  assert.deepEqual(valuesOf(budget, 'Unit'), ['USD']);
});

test('the budget amount is a parameter whose ceiling is the US$15 target', () => {
  const { entries, unreadable } = entriesOf(TEMPLATE, 'Parameters');
  assert.deepEqual(unreadable, [], `unreadable Parameters entries: ${unreadable.join(', ')}`);

  const amounts = valuesOf(theBudget(), 'Amount');
  assert.equal(amounts.length, 1, 'one limit, so there is one number to check');
  const ref = /^!Ref\s+(\S+)$/.exec(amounts[0]);
  assert.ok(ref, `the limit must be !Ref to a parameter, not the literal ${amounts[0]}`);

  const param = entries.get(ref[1]);
  assert.ok(param, `${ref[1]} is not a parameter of this template`);
  const [def] = valuesOf(param, 'Default');
  const [max] = valuesOf(param, 'MaxValue');
  assert.ok(def, `${ref[1]} needs a sensible Default`);
  assert.ok(max, `${ref[1]} needs a MaxValue, so no deploy can set a budget above the target`);

  // 15 is the documented target (design §10 title). A budget above it would not be a guard.
  assert.ok(Number(def) <= 15, `Default ${def} is above the US$15 target`);
  assert.ok(Number(max) <= 15, `MaxValue ${max} is above the US$15 target`);
});

test('every budget notification reaches a parameterised address, and warns on forecast too', () => {
  // Per notification, not "`Address:` appears somewhere in the budget". The 50% rung is the one
  // that makes a MONTHLY budget useful at all — the first email lands at $5 of a $15 project — and
  // a rung with its `Subscribers` dropped satisfied "at least one Address exists" from the other
  // two while quietly notifying nobody.
  const { entries } = entriesOf(TEMPLATE, 'Parameters');
  const notifications = itemsUnder(theBudget(), 'NotificationsWithSubscribers');
  assert.ok(notifications.length >= 3, `found ${notifications.length} notifications — expected at least three rungs`);

  const silent = [];
  const literals = [];
  const types = [];
  const thresholds = [];

  for (const item of notifications) {
    const [type] = valuesOf(item, 'NotificationType');
    const [threshold] = valuesOf(item, 'Threshold');
    const where = `${type ?? '(no NotificationType)'} ${threshold ?? '?'}%`;
    assert.ok(type, `a notification with no readable NotificationType: ${item.join(' | ')}`);
    assert.ok(threshold, `${where} has no readable Threshold`);
    types.push(type);
    thresholds.push(Number(threshold));

    const addresses = valuesOf(item, 'Address');
    if (addresses.length === 0) { silent.push(`${where} notifies nobody`); continue; }
    for (const address of addresses) {
      const ref = /^!Ref\s+(\S+)$/.exec(address);
      if (!ref) { literals.push(`${where} names ${address} rather than !Ref to a parameter`); continue; }
      const param = entries.get(ref[1]);
      if (!param) { literals.push(`${where} refs ${ref[1]}, which is not a parameter`); continue; }
      // A default here bakes the owner's address into a public repo.
      if (valuesOf(param, 'Default').length) literals.push(`${ref[1]} has a Default`);
    }
  }

  assert.deepEqual(silent, [], `a budget rung that notifies nobody is not an alert:\n  ${silent.join('\n  ')}`);
  assert.deepEqual(literals, [], `every subscriber must be !Ref to a Default-less parameter:\n  ${literals.join('\n  ')}`);

  assert.ok(types.includes('ACTUAL'), 'an ACTUAL threshold is what catches spend that happened');
  assert.ok(types.includes('FORECASTED'), 'a FORECASTED threshold is what catches it beforehand');
  for (const threshold of thresholds) {
    assert.ok(threshold > 0 && threshold <= 100, `threshold ${threshold}% does not guard the budget`);
  }
});

test('no literal email address is committed anywhere in the template', () => {
  // Belt and braces, over the whole file. RFC 2606 reserves example.com/.net/.org for
  // documentation, so an address there cannot be anyone's — the ConstraintDescription uses one to
  // show the expected shape.
  const prose = TEMPLATE.replace(/[A-Za-z0-9._%+-]+@example\.(com|net|org)\b/g, '');
  const literal = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(prose);
  assert.equal(literal, null, `template.yaml contains a literal address: ${literal?.[0]}`);
});

// ---------------------------------------------------------------------------
// 4. The proof. Three mutated templates, each a real way to lose a cost guard,
//    and on each one the assertions this file replaced stay green.
//
//    Kept because "the new check is better" is a claim, and this is the only
//    form of it that goes red if someone reverts the rebuild.
// ---------------------------------------------------------------------------

/** The old reader, verbatim: a resource was a `[A-Za-z0-9]+` key with nothing after the colon. */
function oldBlock(text, sectionName, name) {
  const head = `\n${sectionName}:\n`;
  const start = text.indexOf(head);
  const rest = text.slice(start + head.length);
  const next = /^[A-Za-z]/m.exec(rest);
  const sectionText = rest.slice(0, next ? next.index : rest.length);

  const heads = [...sectionText.matchAll(/^ {2}([A-Za-z0-9]+):[ ]*$/gm)];
  const i = heads.findIndex((h) => h[1] === name);
  return i >= 0 ? sectionText.slice(heads[i].index, heads[i + 1]?.index ?? sectionText.length) : null;
}

/** The old block-list of types and properties that bill while idle. */
const OLD_BILLS_WHILE_IDLE = [
  'AWS::EC2::', 'AWS::ElasticLoadBalancing', 'AWS::RDS::', 'AWS::ElastiCache::',
  'AWS::OpenSearchService::', 'AWS::Kinesis::', 'AWS::MSK::', 'AWS::NetworkFirewall::',
  'AWS::Lambda::Alias', 'ProvisionedConcurrencyConfig', 'ProvisionedThroughput',
  'BillingMode: PROVISIONED', 'VpcConfig',
];

/** The three old assertions under test, as predicates: true means the old guard passed. */
const OLD_ASSERTIONS = {
  'nothing in the template bills per hour or per provisioned unit':
    (text) => !OLD_BILLS_WHILE_IDLE.some((needle) => text.includes(needle)),

  'every DynamoDB table stays on-demand':
    (text) => (text.match(/Type:\s*AWS::DynamoDB::Table/g) ?? []).length === 8
      && (text.match(/BillingMode:\s*PAY_PER_REQUEST/g) ?? []).length === 8,

  'the budget warns on forecast as well as on actual spend, and notifies someone':
    (text) => {
      const budget = oldBlock(text, 'Resources', 'SpendBudget');
      if (budget === null) return false;
      const types = [...budget.matchAll(/^\s*NotificationType:\s*(\w+)\s*$/gm)].map((m) => m[1]);
      const addresses = [...budget.matchAll(/^\s*Address:\s*(.+?)\s*$/gm)].map((m) => m[1]);
      return types.includes('ACTUAL') && types.includes('FORECASTED')
        && addresses.length > 0 && addresses.every((a) => /^!Ref\s+\w+$/.test(a));
    },
};

/** Replace the first occurrence only, and fail loudly if the anchor has moved. */
function replaceFirst(text, needle, replacement) {
  const at = text.indexOf(needle);
  assert.ok(at >= 0, `the mutation anchor is no longer in template.yaml:\n${needle}`);
  return text.slice(0, at) + replacement + text.slice(at + needle.length);
}

const SUBSCRIBERS = '\n          Subscribers:\n            - SubscriptionType: EMAIL\n              Address: !Ref BudgetAlertEmail';

const MUTANTS = {
  // 1. A key spelling the old reader could not see, carrying a type its block-list did not know.
  //    `AWS::Transfer::Server` is ~US$0.30/hr whether anyone uploads anything or not: ~US$216 a
  //    month against a US$15 budget, and `AWS::Kinesis::` not matching
  //    `AWS::KinesisFirehose::DeliveryStream` is the same hole with a different name in it.
  'a hyphenated, comment-tailed resource billing US$216/month': (text) => replaceFirst(
    text,
    '  SpendBudget:\n',
    '  Sftp-Server: # parked until the school wants a file drop\n'
    + '    Type: AWS::Transfer::Server\n'
    + '    Properties:\n'
    + '      Protocols: [SFTP]\n\n'
    + '  SpendBudget:\n',
  ),

  // 2. The capability actually granted, with the existence check still satisfied. The 50% rung —
  //    the only one that fires early enough to act on — is left notifying nobody, while the other
  //    two rungs keep `Address:` appearing and both NotificationTypes present.
  'the early-warning budget rung left notifying nobody': (text) => replaceFirst(
    text,
    `            Threshold: 50${SUBSCRIBERS}`,
    '            Threshold: 50',
  ),

  // 3. A table off on-demand, with the old counts still balancing. CloudFormation's default for a
  //    missing `BillingMode` is PROVISIONED — 5 RCU/5 WCU billed by the hour — and the comment
  //    put in its place keeps the old regex count at eight, because that regex never stripped one.
  'a table reverted to PROVISIONED while the counts still balance': (text) => replaceFirst(
    text,
    '      TableName: !Sub "${AWS::StackName}-marks"\n      BillingMode: PAY_PER_REQUEST\n',
    '      TableName: !Sub "${AWS::StackName}-marks"\n'
    + '      # BillingMode: PAY_PER_REQUEST — set at the account level instead\n',
  ),
};

/** The rebuilt assertions, against an arbitrary template text. */
const NEW_ASSERTIONS = {
  'every resource is a costed type': (text) => {
    const { resources, unreadable, declared } = resourcesOf(text);
    assert.deepEqual(unreadable, []);
    assert.equal(resources.size, declared);
    assert.deepEqual([...resources].filter(([, r]) => !COSTS_NOTHING_IDLE.has(r.type)).map(([n]) => n), []);
  },
  'no property bills while idle': (text) => {
    const lines = text.split('\n').map(uncomment);
    assert.deepEqual(IDLE_BILLING.filter(([p]) => lines.some((l) => p.test(l))).map(([, w]) => w), []);
  },
  'every table names PAY_PER_REQUEST itself': (text) => {
    const { resources } = resourcesOf(text);
    const tables = [...resources].filter(([, r]) => r.type === 'AWS::DynamoDB::Table');
    assert.equal(tables.length, 8);
    for (const [name, r] of tables) {
      assert.deepEqual(valuesOf(r.lines, 'BillingMode'), ['PAY_PER_REQUEST'], name);
    }
  },
  'every budget rung notifies a parameterised address': (text) => {
    const { entries } = entriesOf(text, 'Parameters');
    const { resources } = resourcesOf(text);
    const [[, budget]] = [...resources].filter(([, r]) => r.type === 'AWS::Budgets::Budget');
    for (const item of itemsUnder(budget.lines, 'NotificationsWithSubscribers')) {
      const addresses = valuesOf(item, 'Address');
      assert.ok(addresses.length > 0, `a rung notifying nobody: ${item.join(' | ')}`);
      for (const address of addresses) {
        const ref = /^!Ref\s+(\S+)$/.exec(address);
        assert.ok(ref && entries.has(ref[1]), address);
      }
    }
  },
};

test('the rebuilt guard catches the three shapes the old one missed', () => {
  // Sanity: both sets of assertions pass on the template as committed, or the mutations below
  // prove nothing at all.
  for (const [name, holds] of Object.entries(OLD_ASSERTIONS)) {
    assert.equal(holds(TEMPLATE), true, `old assertion "${name}" should pass on the real template`);
  }
  for (const [name, check] of Object.entries(NEW_ASSERTIONS)) {
    assert.doesNotThrow(() => check(TEMPLATE), `new assertion "${name}" should pass on the real template`);
  }

  for (const [what, mutate] of Object.entries(MUTANTS)) {
    const mutant = mutate(TEMPLATE);
    assert.notEqual(mutant, TEMPLATE, `${what}: the mutation changed nothing`);

    // This is the defect, stated as a test: every old assertion stayed green on this shape.
    for (const [name, holds] of Object.entries(OLD_ASSERTIONS)) {
      assert.equal(holds(mutant), true,
        `${what}: the old assertion "${name}" was expected to miss it — if it now catches it, this record is stale`);
    }

    // And at least one rebuilt assertion goes red on it.
    const red = Object.entries(NEW_ASSERTIONS).filter(([, check]) => {
      try { check(mutant); return false; } catch { return true; }
    }).map(([name]) => name);

    assert.ok(red.length > 0, `${what}: no rebuilt assertion caught it — the rebuild is not done`);
  }
});
