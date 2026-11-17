// Would this actually run in Lambda?
//
// Unit tests import handlers directly from the repo, where every path resolves. SAM ships only
// what is under a function's CodeUri. Those two facts disagreed: every handler imports
// `../../lib/auth.mjs`, but each CodeUri was its own directory, so the deployed bundles would have
// been missing the shared modules and every cold start would have died on MODULE_NOT_FOUND —
// with a fully green test suite.
//
// This is the second bug of exactly that shape (the first was the table env var names). Both are
// invisible to a test that mocks the boundary, so both get checked against the template instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BACKEND = join(ROOT, 'backend');
const template = readFileSync(join(BACKEND, 'template.yaml'), 'utf8');

/** Every Serverless::Function's CodeUri and Handler, in template order. */
function functions() {
  const out = [];
  const re = /CodeUri:\s*(\S+)\s*\n\s*Handler:\s*(\S+)/g;
  for (const [, codeUri, handler] of template.matchAll(re)) {
    out.push({ codeUri, handler });
  }
  return out;
}

/** Resolve `functions/chat/index.handler` under a CodeUri to the file on disk. */
function handlerFile(codeUri, handler) {
  const path = handler.replace(/\.[^.]+$/, '');           // drop the exported function name
  return join(BACKEND, codeUri, `${path}.mjs`);
}

/** Follow relative imports transitively from an entry point. */
function importedFiles(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  if (!existsSync(entry)) return seen;

  const src = readFileSync(entry, 'utf8');
  // Static `from '...'` and dynamic `import('...')`, relative specifiers only.
  const specs = [
    ...[...src.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\(\s*'(\.[^']+)'\s*\)/g)].map((m) => m[1]),
  ];
  for (const spec of specs) importedFiles(resolve(dirname(entry), spec), seen);
  return seen;
}

test('the template declares a handler for every function', () => {
  const fns = functions();
  assert.equal(fns.length, 8, `expected 8 functions, found ${fns.length}`);
  for (const { codeUri, handler } of fns) {
    assert.ok(handler.endsWith('.handler'), `${handler} does not end in .handler`);
    // Every one of the eight functions is written now, so there is no exemption left to make.
    assert.ok(existsSync(handlerFile(codeUri, handler)),
      `${handler} does not resolve to a file under ${codeUri}`);
  }
});

test('every relative import stays inside the packaged CodeUri', () => {
  const problems = [];

  for (const { codeUri, handler } of functions()) {
    const entry = handlerFile(codeUri, handler);
    if (!existsSync(entry)) continue;   // not written yet; the test above tracks that

    const packageRoot = resolve(BACKEND, codeUri);
    for (const file of importedFiles(entry)) {
      if (!existsSync(file)) {
        problems.push(`${handler}: imports missing file ${relative(ROOT, file)}`);
        continue;
      }
      const rel = relative(packageRoot, file);
      if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
        problems.push(`${handler}: imports ${relative(ROOT, file)}, which is outside CodeUri ${codeUri}`);
      }
    }
  }

  assert.deepEqual(problems, [],
    `these would fail with MODULE_NOT_FOUND in Lambda:\n  ${problems.join('\n  ')}`);
});

test('no handler imports a package that is not in the Lambda runtime', () => {
  // The repo has zero dependencies on purpose. Only the AWS SDK v3, which ships inside nodejs20.x,
  // and node: builtins may be imported by name.
  const allowed = /^(@aws-sdk\/|node:)/;
  const problems = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.mjs')) {
        const src = readFileSync(path, 'utf8');
        for (const [, spec] of src.matchAll(/from\s+'([^'.][^']*)'/g)) {
          if (!allowed.test(spec)) problems.push(`${relative(ROOT, path)} imports "${spec}"`);
        }
      }
    }
  };
  walk(join(BACKEND, 'functions'));
  walk(join(BACKEND, 'lib'));

  assert.deepEqual(problems, [], `unavailable at runtime:\n  ${problems.join('\n  ')}`);
});
