import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const FJOIN_BIN = resolve('index.js');
const TEST_DIR = join(tmpdir(), `fjoin-nested-git-test-${Date.now()}`);
const SAMPLE_PROJECT = join(TEST_DIR, 'sample_project');

test.before(async () => {
  await fs.mkdir(SAMPLE_PROJECT, { recursive: true });
  await fs.mkdir(join(SAMPLE_PROJECT, 'subdir'), { recursive: true });
  
  // Root files
  await fs.writeFile(join(SAMPLE_PROJECT, '.gitignore'), "root_ignored.txt");
  await fs.writeFile(join(SAMPLE_PROJECT, 'root_ignored.txt'), 'ignored at root');
  await fs.writeFile(join(SAMPLE_PROJECT, 'root_ok.txt'), 'ok at root');
  
  // Subdir files
  await fs.writeFile(join(SAMPLE_PROJECT, 'subdir/.gitignore'), "sub_ignored.txt");
  await fs.writeFile(join(SAMPLE_PROJECT, 'subdir/sub_ignored.txt'), 'ignored in subdir');
  await fs.writeFile(join(SAMPLE_PROJECT, 'subdir/sub_ok.txt'), 'ok in subdir');
});

test.after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

function run(args, cwd = SAMPLE_PROJECT) {
  const matches = args.match(/(?:[^\s"]+|"[^"]*")+/g);
  const parsedArgs = matches ? matches.map(s => s.replace(/^"|"$/g, '')) : [];
  return spawnSync('node', [FJOIN_BIN, ...parsedArgs], { cwd, encoding: 'utf-8' });
}

test('should respect nested .gitignore files', (t) => {
  const result = run('.');
  assert.strictEqual(result.status, 0);
  
  assert.ok(result.stdout.includes('root_ok.txt'), 'Should include root_ok.txt');
  assert.ok(!result.stdout.includes('root_ignored.txt'), 'Should NOT include root_ignored.txt');
  
  assert.ok(result.stdout.includes('subdir/sub_ok.txt'), 'Should include subdir/sub_ok.txt');
  // This is the current failing behavior: it will likely include sub_ignored.txt
  assert.ok(!result.stdout.includes('subdir/sub_ignored.txt'), 'Should NOT include subdir/sub_ignored.txt');
});
