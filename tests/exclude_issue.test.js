import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const FJOIN_BIN = resolve('index.js');
const TEST_DIR = join(tmpdir(), `fjoin-exclude-test-${Date.now()}`);

test.before(async () => {
  await fs.mkdir(TEST_DIR, { recursive: true });
  
  // Dir 1 with normal and hidden file
  await fs.mkdir(join(TEST_DIR, 'dir1'), { recursive: true });
  await fs.writeFile(join(TEST_DIR, 'dir1/file.txt'), 'dir1 file');
  await fs.writeFile(join(TEST_DIR, 'dir1/.hidden'), 'dir1 hidden');
  
  // Dir 2 with normal file
  await fs.mkdir(join(TEST_DIR, 'dir2'), { recursive: true });
  await fs.writeFile(join(TEST_DIR, 'dir2/file.txt'), 'dir2 file');

  // Root file
  await fs.writeFile(join(TEST_DIR, 'root.txt'), 'root file');
});

test.after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

function run(args, cwd = TEST_DIR) {
  const matches = args.match(/(?:[^\s"]+|"[^"]*")+/g);
  const parsedArgs = matches ? matches.map(s => s.replace(/^"|"$/g, '')) : [];
  return spawnSync('node', [FJOIN_BIN, ...parsedArgs], { cwd, encoding: 'utf-8' });
}

test('excluding multiple directories', (t) => {
  const result = run('. --exclude dir1 --exclude dir2 --no-gitignore');
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('dir1/file.txt'), 'Should exclude dir1/file.txt');
  assert.ok(!result.stdout.includes('dir2/file.txt'), 'Should exclude dir2/file.txt');
  assert.ok(result.stdout.includes('root.txt'), 'Should include root.txt');
});

test('excluding directory with hidden files', (t) => {
  const result = run('. --exclude dir1 --no-gitignore');
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('dir1/file.txt'), 'Should exclude dir1/file.txt');
  assert.ok(!result.stdout.includes('dir1/.hidden'), 'Should exclude dir1/.hidden');
});

test('excluding directories using glob pattern', (t) => {
  const result = run('. --exclude "dir*" --no-gitignore');
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('dir1/file.txt'), 'Should exclude dir1/file.txt when matched by glob');
  assert.ok(!result.stdout.includes('dir2/file.txt'), 'Should exclude dir2/file.txt when matched by glob');
});
