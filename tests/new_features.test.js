import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const FJOIN_BIN = resolve('index.js');
const TEST_DIR = join(tmpdir(), `fjoin-new-feature-test-${Date.now()}`);

test.before(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(join(TEST_DIR, '.gitignore'), 'test.js\nignored/');
  await fs.writeFile(join(TEST_DIR, 'test.js'), 'test content');
  await fs.writeFile(join(TEST_DIR, 'normal.js'), 'normal content');
  await fs.mkdir(join(TEST_DIR, 'ignored'), { recursive: true });
  await fs.writeFile(join(TEST_DIR, 'ignored/file.js'), 'ignored content');
});

test.after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

function run(args, cwd = TEST_DIR) {
  const matches = args.match(/(?:[^\s"]+|"[^"]*")+/g);
  const parsedArgs = matches ? matches.map(s => s.replace(/^"|"$/g, '')) : [];
  return spawnSync('node', [FJOIN_BIN, ...parsedArgs], { cwd, encoding: 'utf-8' });
}

test('fjoin -i "*test*" should work without positionals and only include test files', (t) => {
  const result = run('-i "*test*"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: test.js'));
  assert.ok(!result.stdout.includes('# FILE: normal.js'), 'Should ONLY include test files if only -i is provided');
});

test('fjoin . -e "*" -i "*test*" should include only test files', (t) => {
  const result = run('. -e "*" -i "*test*"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: test.js'));
  assert.ok(!result.stdout.includes('# FILE: normal.js'));
});

test('fjoin "*test*" should include test.js even if gitignored', (t) => {
  const result = run('"*test*"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: test.js'));
  assert.ok(!result.stdout.includes('# FILE: normal.js'), 'Should ONLY include test files if ONLY glob passed');
});
