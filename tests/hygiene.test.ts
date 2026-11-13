/**
 * Rules about the codebase itself, so the guarantees in the README cannot quietly rot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, exts));
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

const sourceFiles = [
  ...walk(join(root, 'src'), ['.ts', '.html', '.css', '.json']),
  ...walk(join(root, 'scripts'), ['.mjs']),
];
const allFiles = [...sourceFiles, ...walk(join(root, 'tests'), ['.ts', '.html'])];

test('the source files were found', () => {
  assert.ok(sourceFiles.length >= 15, `only found ${sourceFiles.length} source files`);
});

test('no eval, no new Function, no dynamic code', () => {
  for (const file of allFiles) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\beval\s*\(/.test(text), `${file} uses eval`);
    assert.ok(!/new\s+Function\s*\(/.test(text), `${file} uses new Function`);
    assert.ok(!/\bsetTimeout\s*\(\s*['"`]/.test(text), `${file} passes a string to setTimeout`);
  }
});

test('no HTML is ever assigned from a string', () => {
  for (const file of allFiles) {
    if (file.endsWith('.html')) continue;
    const text = readFileSync(file, 'utf8');
    // Property access, not the bare word, so a comment explaining the rule is fine.
    for (const pattern of [
      /\.\s*(?:inner|outer)HTML\b/,
      /\.insertAdjacentHTML\s*\(/,
      /document\s*\.\s*write\s*\(/,
    ]) {
      assert.ok(!pattern.test(text), `${file} assigns or writes HTML: ${pattern.source}`);
    }
  }
});

test('the only host in the source is github.com over https', () => {
  const allowed = new Set(['https://github.com', 'https://www.github.com']);
  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    // `http://` on its own is allowed: the validator has to name the scheme it rejects.
    assert.ok(!/http:\/\/[A-Za-z0-9]/.test(text), `${file} contains a plaintext http:// URL`);
    for (const match of text.match(/https:\/\/[A-Za-z0-9.-]+/g) ?? []) {
      // claude.com and similar never appear; anything but github.com is a mistake.
      assert.ok(allowed.has(match), `${file} references ${match}`);
    }
  }
});

test('no tokens, secrets or credentials anywhere', () => {
  const forbidden: [RegExp, string][] = [
    [/\bgh[pousr]_[A-Za-z0-9]{16,}/, 'a GitHub token'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'a GitHub fine-grained token'],
    [/\bBearer\s+[A-Za-z0-9._-]{12,}/, 'a bearer token'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
    [/\b(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*['"][^'"]{8,}/i, 'a hardcoded credential'],
    [/\bpassword\s*[:=]\s*['"][^'"]+/i, 'a hardcoded password'],
    [/[A-Za-z0-9._%+-]+@(?!evil\.com|evil\.example)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
  ];
  for (const file of allFiles) {
    const text = readFileSync(file, 'utf8');
    for (const [pattern, what] of forbidden) {
      const hit = pattern.exec(text);
      assert.equal(hit, null, `${file} contains ${what}: ${hit?.[0] ?? ''}`);
    }
  }
});

test('no real profile is baked into the code or the fixtures', () => {
  // Fixtures use octo-tester. A real username here would mean real data got committed.
  // This file is skipped because it has to spell the names out to look for them.
  const names = ['chefgs', 'octocat'];
  const selfPath = fileURLToPath(import.meta.url);
  const scanned = allFiles.filter((file) => file !== selfPath);
  assert.ok(scanned.length === allFiles.length - 1, 'this test file should be excluded exactly once');

  for (const file of scanned) {
    const text = readFileSync(file, 'utf8');
    for (const name of names) {
      // octocat is GitHub's own mascot account, fine as placeholder text in the UI and
      // in tests, but it must never appear in a fixture as though it were scraped data.
      if (name === 'octocat' && !file.includes('fixtures')) continue;
      assert.ok(!new RegExp(`\\b${name}\\b`).test(text), `${file} names the real profile "${name}"`);
    }
  }
});

test('the extension asks for the narrowest permissions it can', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'src', 'ext', 'manifest.json'), 'utf8')) as {
    permissions: string[];
    host_permissions: string[];
    content_security_policy: { extension_pages: string };
    manifest_version: number;
  };
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, [], 'no API permissions are needed');
  assert.deepEqual(manifest.host_permissions, ['https://github.com/users/*'],
    'only the contributions path on github.com');
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/, 'only our own scripts may run');
  assert.ok(!csp.includes('unsafe-inline'), 'no inline script or style');
  assert.ok(!csp.includes('unsafe-eval'), 'no eval');
  assert.match(csp, /connect-src https:\/\/github\.com/, 'the page may only ever connect to github.com');
});

test('the page loads no remote resource', () => {
  const html = readFileSync(join(root, 'src', 'ui', 'app.html'), 'utf8');
  for (const match of html.match(/(?:href|src)="([^"]+)"/g) ?? []) {
    assert.ok(!/\/\//.test(match), `app.html loads something remote: ${match}`);
  }
  assert.ok(!html.includes('fonts.googleapis.com'), 'no webfont requests');
  const css = readFileSync(join(root, 'src', 'ui', 'app.css'), 'utf8');
  assert.ok(!css.includes('@import'), 'no CSS imports');
  assert.ok(!/url\(\s*['"]?https?:/.test(css), 'no remote CSS assets');
});

test('the project has no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies, undefined, 'dependencies must stay empty');
  // Dev-only, and only the two that build and typecheck the project.
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), ['@types/node', 'esbuild', 'typescript']);
});

test('no TODO or FIXME without a linked issue', () => {
  for (const file of allFiles) {
    for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      // Only comment markers count, so this rule does not match its own source.
      if (/(?:\/\/|\/\*|^\s*\*|#)\s*(?:TODO|FIXME)\b/.test(line)) {
        assert.match(line, /#\d+|https:\/\/github\.com\/[^ ]+\/issues\/\d+/,
          `${file}:${i + 1} has a TODO with no issue link`);
      }
    }
  }
});

test('every element id the app looks up exists in app.html', () => {
  const appTs = readFileSync(join(root, 'src', 'ui', 'app.ts'), 'utf8');
  const html = readFileSync(join(root, 'src', 'ui', 'app.html'), 'utf8');

  const ids = new Set<string>();
  for (const match of appTs.matchAll(/\bel<[^>]+>\('([^']+)'\)/g)) ids.add(match[1]!);
  assert.ok(ids.size >= 30, `expected to find the app's element lookups, found ${ids.size}`);

  const present = new Set<string>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) present.add(match[1]!);

  for (const id of ids) {
    // A missing id throws at startup and leaves a blank page, so this must hold exactly.
    assert.ok(present.has(id), `app.ts looks up #${id}, which app.html does not define`);
  }
});

test('ids in app.html are unique', () => {
  const html = readFileSync(join(root, 'src', 'ui', 'app.html'), 'utf8');
  const seen = new Set<string>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    const id = match[1]!;
    assert.ok(!seen.has(id), `duplicate id in app.html: ${id}`);
    seen.add(id);
  }
});

test('every form control in app.html has a label or an accessible name', () => {
  const html = readFileSync(join(root, 'src', 'ui', 'app.html'), 'utf8');
  const labelled = new Set<string>();
  for (const match of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) labelled.add(match[1]!);

  for (const match of html.matchAll(/<(input|select|textarea)\s([^>]*)>/g)) {
    const attrs = match[2]!;
    if (attrs.includes('hidden')) continue;
    // attrs has no leading space: the tag-name match consumed it.
    const id = /(?:^|\s)id="([^"]+)"/.exec(attrs)?.[1];
    const named = attrs.includes('aria-label') || (id !== undefined && labelled.has(id));
    assert.ok(named, `<${match[1]} id="${id ?? '?'}"> has no label or aria-label`);
  }
});
