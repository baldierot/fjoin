import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

const FJOIN_BIN = resolve('index.js');
const TEST_DIR = join(tmpdir(), `fjoin-test-${Date.now()}`);
const SAMPLE_PROJECT = join(TEST_DIR, 'sample_project');

test.before(async () => {
  await fs.mkdir(SAMPLE_PROJECT, { recursive: true });
  await fs.mkdir(join(SAMPLE_PROJECT, 'src'), { recursive: true });
  await fs.mkdir(join(SAMPLE_PROJECT, 'docs'), { recursive: true });
  await fs.mkdir(join(SAMPLE_PROJECT, 'node_modules'), { recursive: true });

  await fs.writeFile(join(SAMPLE_PROJECT, '.gitignore'), "ignored.txt\nnode_modules/");
  await fs.writeFile(join(SAMPLE_PROJECT, 'index.js'), "console.log('hello')");
  await fs.writeFile(join(SAMPLE_PROJECT, 'README.md'), "This is a README");
  await fs.writeFile(join(SAMPLE_PROJECT, 'ignored.txt'), "This should be ignored");
  await fs.writeFile(join(SAMPLE_PROJECT, 'node_modules/secret.txt'), "secret");
  await fs.writeFile(join(SAMPLE_PROJECT, 'src/main.js'), "main code");
  await fs.writeFile(join(SAMPLE_PROJECT, 'docs/api.md'), "api docs");
});

test.after(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

function run(args, cwd = SAMPLE_PROJECT) {
  const matches = args.match(/(?:[^\s"]+|"[^"]*")+/g);
  const parsedArgs = matches ? matches.map(s => s.replace(/^"|"$/g, '')) : [];
  return spawnSync('node', [FJOIN_BIN, ...parsedArgs], { cwd, encoding: 'utf-8' });
}

test('basic concatenation', (t) => {
  const result = run('index.js README.md');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: index.js'));
  assert.ok(result.stdout.includes("console.log('hello')"));
  assert.ok(result.stdout.includes('# FILE: README.md'));
  assert.ok(result.stdout.includes("This is a README"));
});

test('glob patterns', (t) => {
  const result = run('"src/*.js" "docs/*.md"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: src/main.js'));
  assert.ok(result.stdout.includes('main code'));
  assert.ok(result.stdout.includes('# FILE: docs/api.md'));
  assert.ok(result.stdout.includes('api docs'));
});

test('respects .gitignore and ignores .git/ by default', async (t) => {
  const gitDir = join(SAMPLE_PROJECT, '.git');
  await fs.mkdir(gitDir, { recursive: true });
  await fs.writeFile(join(gitDir, 'config'), 'git config');

  const result = run('.');
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('# FILE: ignored.txt'));
  assert.ok(!result.stdout.includes('# FILE: node_modules/secret.txt'));
  assert.ok(!result.stdout.includes('# FILE: .git/config'));
});

test('--no-gitignore flag', (t) => {
  const result = run('. .git --no-gitignore');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: ignored.txt'));
  assert.ok(result.stdout.includes('# FILE: .git/config'));
});

test('--include flag overrides .gitignore', (t) => {
  const result = run('. --include "ignored.txt"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes('# FILE: ignored.txt'));
});

test('--exclude flag', (t) => {
  const result = run('. --exclude "src/main.js"');
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('# FILE: src/main.js'));
});

test('--output flag', async (t) => {
  const outputPath = join(SAMPLE_PROJECT, 'output.md');
  const result = run(`index.js --output output.md`);
  assert.strictEqual(result.status, 0);
  const content = await fs.readFile(outputPath, 'utf-8');
  assert.ok(content.includes('# FILE: index.js'));
  await fs.unlink(outputPath);
});

test('--force flag', async (t) => {
  const outputPath = join(SAMPLE_PROJECT, 'existing.md');
  await fs.writeFile(outputPath, 'pre-existing');
  
  const errorResult = run('index.js --output existing.md');
  assert.notStrictEqual(errorResult.status, 0);
  assert.ok(errorResult.stderr.includes('already exists'));
  
  const forceResult = run('index.js --output existing.md --force');
  assert.strictEqual(forceResult.status, 0);
  const content = await fs.readFile(outputPath, 'utf-8');
  assert.ok(content.includes('# FILE: index.js'));
  await fs.unlink(outputPath);
});

test('--verbose flag', (t) => {
  const result = run('. --verbose');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stderr.includes('gitignored file(s) skipped'), 'Should show warnings in verbose mode');
});

test('custom ignore file', async (t) => {
  const ignoreFile = join(SAMPLE_PROJECT, '.customignore');
  await fs.writeFile(ignoreFile, 'src/main.js');
  const result = run('. --ignore-file .customignore');
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('# FILE: src/main.js'));
  await fs.unlink(ignoreFile);
});

test('clean error message for missing output directory', (t) => {
  const result = run('index.js -o missing_dir/out.md');
  assert.notStrictEqual(result.status, 0);
  assert.ok(result.stderr.includes("Error writing to 'missing_dir/out.md'"));
});

test('relative paths in warnings', async (t) => {
  const binaryFile = join(SAMPLE_PROJECT, 'test.bin');
  await fs.writeFile(binaryFile, Buffer.from([0, 1, 2, 3]));
  
  const result = run('test.bin --verbose');
  assert.ok(result.stderr.includes('  test.bin'));
  assert.ok(!result.stderr.includes(SAMPLE_PROJECT));
  
  await fs.unlink(binaryFile);
});

test('duplicate files handled correctly', (t) => {
  const result = run('index.js index.js');
  const matches = result.stdout.match(/# FILE: index\.js/g);
  assert.strictEqual(matches.length, 1);
});
