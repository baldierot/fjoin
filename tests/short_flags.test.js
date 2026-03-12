import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const FJOIN_BIN = resolve('index.js');
const TEST_DIR = join(tmpdir(), `fjoin-short-flag-test-${Date.now()}`);
const SAMPLE_PROJECT = join(TEST_DIR, 'sample_project');

test.before(async () => {
  await fs.mkdir(SAMPLE_PROJECT, { recursive: true });
  await fs.writeFile(join(SAMPLE_PROJECT, '.gitignore'), "ignored.txt");
  await fs.writeFile(join(SAMPLE_PROJECT, 'index.js'), "console.log('hello')");
  await fs.writeFile(join(SAMPLE_PROJECT, 'ignored.txt'), "This should be ignored");
});

test.after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

function run(args, cwd = SAMPLE_PROJECT) {
  const matches = args.match(/(?:[^\s"]+|"[^"]*")+/g);
  const parsedArgs = matches ? matches.map(s => s.replace(/^"|"$/g, '')) : [];
  return spawnSync('node', [FJOIN_BIN, ...parsedArgs], { cwd, encoding: 'utf-8' });
}

test('short flag -i for --include', (t) => {
  const result = run('. -i ignored.txt');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: ignored.txt'), 'Should include ignored file with -i');
});

test('short flag -I for --no-gitignore', (t) => {
  const result = run('. -I --quiet');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: ignored.txt'), 'Should include ignored file with -I');
});
