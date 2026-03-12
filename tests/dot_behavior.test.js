import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const FJOIN_BIN = resolve('index.js');
const TEST_DIR = join(tmpdir(), `fjoin-dot-test-${Date.now()}`);
const SAMPLE_PROJECT = join(TEST_DIR, 'sample_project');

test.before(async () => {
  await fs.mkdir(SAMPLE_PROJECT, { recursive: true });
  await fs.mkdir(join(SAMPLE_PROJECT, '.hidden_dir'), { recursive: true });
  await fs.writeFile(join(SAMPLE_PROJECT, 'normal.txt'), 'normal content');
  await fs.writeFile(join(SAMPLE_PROJECT, '.env'), 'secret=123');
  await fs.writeFile(join(SAMPLE_PROJECT, '.hidden_dir/file.txt'), 'hidden content');
});

test.after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

function run(args, cwd = SAMPLE_PROJECT) {
  const matches = args.match(/(?:[^\s"]+|"[^"]*")+/g);
  const parsedArgs = matches ? matches.map(s => s.replace(/^"|"$/g, '')) : [];
  return spawnSync('node', [FJOIN_BIN, ...parsedArgs], { cwd, encoding: 'utf-8' });
}

test('default behavior should skip hidden files and directories', (t) => {
  const result = run('.');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('normal.txt'));
  assert.ok(!result.stdout.includes('.env'), 'Should NOT include .env by default');
  assert.ok(!result.stdout.includes('.hidden_dir/file.txt'), 'Should NOT include files in .hidden_dir by default');
});

test('explicitly including hidden files should work', (t) => {
  const result = run('.env');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('.env'), 'Should include .env when explicitly requested');
});

test('explicitly including hidden directories should work', (t) => {
  const result = run('.hidden_dir');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('.hidden_dir/file.txt'), 'Should include files in .hidden_dir when explicitly requested');
});

test('glob for dotfiles should work', (t) => {
  const result = run('".*"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('.env'), 'Should include .env when matched by .*');
});
