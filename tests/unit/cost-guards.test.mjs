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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const template = readFileSync(new URL('../../backend/template.yaml', import.meta.url), 'utf8');

/** One whole top-level section (`Parameters:`, `Resources:`), up to the next column-0 key. */
function section(name) {
  const head = `\n${name}:\n`;
  const start = template.indexOf(head);
  assert.ok(start >= 0, `template.yaml has no ${name}: section`);
  const rest = template.slice(start + head.length);
  const next = /^[A-Za-z]/m.exec(rest);          // comments start with #, so this finds the next key
  return rest.slice(0, next ? next.index : rest.length);
}

/** One named block inside a section, found by indentation: `  Name:` to the next `  Name:`. */
function block(sectionText, name) {
  const heads = [...sectionText.matchAll(/^ {2}([A-Za-z0-9]+):[ ]*$/gm)];
  const i = heads.findIndex((h) => h[1] === name);
  assert.ok(i >= 0, `no block named ${name}`);
  return sectionText.slice(heads[i].index, heads[i + 1]?.index ?? sectionText.length);
}

const parameters = section('Parameters');
const resources = section('Resources');

// ---------------------------------------------------------------------------
// 1. The budget alert exists, and exists in the template rather than a console step.
// ---------------------------------------------------------------------------

test('the stack creates exactly one AWS::Budgets::Budget', () => {
  const budgets = template.match(/Type:\s*AWS::Budgets::Budget/g) ?? [];
  assert.equal(
    budgets.length, 1,
    'design §10 requires one cost budget created by the deploy, not by hand afterwards',
  );
});

test('the budget is a monthly COST budget in USD', () => {
  const budget = block(resources, 'SpendBudget');
  assert.match(budget, /^\s*BudgetType:\s*COST\s*$/m, 'BudgetType must be COST');
  assert.match(budget, /^\s*TimeUnit:\s*MONTHLY\s*$/m, 'TimeUnit must be MONTHLY');
  assert.match(budget, /^\s*Unit:\s*USD\s*$/m, 'the limit must be in USD');
});

test('the budget amount is a parameter whose ceiling is the US$15 target', () => {
  const budget = block(resources, 'SpendBudget');
  const amount = /^\s*Amount:\s*!Ref\s+(\w+)\s*$/m.exec(budget);
  assert.ok(amount, 'the limit must be !Ref to a parameter, not a literal');

  const param = block(parameters, amount[1]);
  const def = /^\s*Default:\s*([\d.]+)\s*$/m.exec(param);
  const max = /^\s*MaxValue:\s*([\d.]+)\s*$/m.exec(param);
  assert.ok(def, `${amount[1]} needs a sensible Default`);
  assert.ok(max, `${amount[1]} needs a MaxValue, so no deploy can set a budget above the target`);

  // 15 is the documented target (design §10 title). A budget above it would not be a guard.
  assert.ok(Number(def[1]) <= 15, `Default ${def[1]} is above the US$15 target`);
  assert.ok(Number(max[1]) <= 15, `MaxValue ${max[1]} is above the US$15 target`);
});

test('the alert address is a parameter with no default, and no literal address is committed', () => {
  const budget = block(resources, 'SpendBudget');
  const addresses = [...budget.matchAll(/^\s*Address:\s*(.+?)\s*$/gm)].map((m) => m[1]);
  assert.ok(addresses.length > 0, 'the budget must notify someone');

  const refs = new Set();
  for (const address of addresses) {
    const ref = /^!Ref\s+(\w+)$/.exec(address);
    assert.ok(ref, `subscriber address ${address} must be !Ref to a parameter, never a literal`);
    refs.add(ref[1]);
  }

  for (const name of refs) {
    const param = block(parameters, name);
    assert.ok(
      !/^\s*Default:/m.test(param),
      `${name} must have no Default — a default here bakes the owner's address into a public repo`,
    );
  }

  // Belt and braces: no email-shaped literal anywhere in the template, under any key. RFC 2606
  // reserves example.com/.net/.org for documentation, so an address there cannot be anyone's —
  // the ConstraintDescription uses one to show the expected shape.
  const prose = template.replace(/[A-Za-z0-9._%+-]+@example\.(com|net|org)\b/g, '');
  const literal = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(prose);
  assert.equal(literal, null, `template.yaml contains a literal address: ${literal?.[0]}`);
});

test('the budget warns on forecast as well as on actual spend', () => {
  const budget = block(resources, 'SpendBudget');
  const types = [...budget.matchAll(/^\s*NotificationType:\s*(\w+)\s*$/gm)].map((m) => m[1]);
  assert.ok(types.includes('ACTUAL'), 'an ACTUAL threshold is what catches spend that happened');
  assert.ok(types.includes('FORECASTED'), 'a FORECASTED threshold is what catches it beforehand');

  for (const m of budget.matchAll(/^\s*Threshold:\s*([\d.]+)\s*$/gm)) {
    assert.ok(Number(m[1]) <= 100, `threshold ${m[1]}% is above the budget it is meant to guard`);
  }
});

// ---------------------------------------------------------------------------
// 2. The structural claim the ten-week cost model rests on.
// ---------------------------------------------------------------------------

// Each of these bills per hour, per month or per provisioned unit — i.e. while nobody is using the
// app. Ten weeks of judging is ~1,700 idle hours, so one NAT gateway (~$0.045/hr) is more than
// twice the entire US$15 project budget on its own. design §10 has the arithmetic.
const BILLS_WHILE_IDLE = [
  ['AWS::EC2::', 'a VPC, NAT gateway or Elastic IP'],
  ['AWS::ElasticLoadBalancing', 'a load balancer'],
  ['AWS::RDS::', 'an RDS instance or cluster'],
  ['AWS::ElastiCache::', 'an ElastiCache node'],
  ['AWS::OpenSearchService::', 'an OpenSearch domain'],
  ['AWS::Kinesis::', 'a Kinesis stream'],
  ['AWS::MSK::', 'an MSK cluster'],
  ['AWS::NetworkFirewall::', 'a network firewall'],
  ['AWS::Lambda::Alias', 'a Lambda alias, which is how provisioned concurrency is attached'],
  ['ProvisionedConcurrencyConfig', 'provisioned Lambda concurrency'],
  ['ProvisionedThroughput', 'provisioned DynamoDB capacity'],
  ['BillingMode: PROVISIONED', 'provisioned DynamoDB capacity'],
  ['VpcConfig', 'a Lambda in a VPC, which needs a NAT gateway to reach AWS APIs'],
];

test('nothing in the template bills per hour or per provisioned unit', () => {
  for (const [needle, what] of BILLS_WHILE_IDLE) {
    assert.ok(
      !template.includes(needle),
      `${needle} — ${what} — bills while idle. design §10 is costed on the claim that nothing here does; re-cost it before adding this.`,
    );
  }
});

test('every DynamoDB table stays on-demand', () => {
  const tables = template.match(/Type:\s*AWS::DynamoDB::Table/g) ?? [];
  const onDemand = template.match(/BillingMode:\s*PAY_PER_REQUEST/g) ?? [];
  assert.equal(tables.length, 8, 'design §4 has eight tables');
  assert.equal(
    onDemand.length, tables.length,
    'a table without PAY_PER_REQUEST bills for capacity it is not using',
  );
});

// ---------------------------------------------------------------------------
// 3. The two deletion rules a judge could trip over. design §10 reads both as
//    cost/privacy guards that do NOT breach "available for testing" — but only
//    while they are the rules that were read. If either changes, that read has
//    to be redone, so they are pinned here.
// ---------------------------------------------------------------------------

test('voice notes still expire after one day, on the voice/ prefix only', () => {
  const bucket = block(resources, 'VoiceBucket');
  assert.match(bucket, /^\s*Prefix:\s*voice\/\s*$/m);
  assert.match(bucket, /^\s*ExpirationInDays:\s*1\s*$/m);
});

test('redteam_runs is the only table with a TTL', () => {
  const ttls = template.match(/TimeToLiveSpecification/g) ?? [];
  assert.equal(ttls.length, 1, 'a TTL on a data table would delete demo data mid-judging');
  assert.match(block(resources, 'RedteamRunsTable'), /TimeToLiveSpecification/);
});
