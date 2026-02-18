#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, relative } from "node:path";
import { stat, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import fg from "fast-glob";
import ignore from "ignore";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: {
      type: "string",
      short: "o",
    },
    force: {
      type: "boolean",
      short: "f",
    },
    'no-gitignore': {
      type: "boolean",
      short: "i",
    },
    quiet: {
      type: "boolean",
      short: "q",
    },
    help: {
      type: "boolean",
      short: "h",
    },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help || (positionals.length === 0)) {
  console.log(`
fjoin - A simple utility to concatenate files into a single document with clear headers and relative paths.

Usage: fjoin [options] <files...>

Options:
  -o, --output <file>    Output to a specific file (default: stdout)
  -f, --force            Overwrite output file if it exists
  -i, --no-gitignore     Ignore .gitignore patterns
  -q, --quiet            Suppress gitignore warnings
  -h, --help             Show this help message

Examples:
  fjoin file1.ts file2.ts
  fjoin src/*.ts -o combined.md
  fjoin src/* -i
  `);
  process.exit(0);
}

let result = "";

async function readGitignore() {
  try {
    const gitignoreContent = await readFile('.gitignore', 'utf-8');
    return ignore().add(gitignoreContent);
  } catch {
    // .gitignore doesn't exist, return an empty ignore instance
    return ignore();
  }
}

async function processPath(path) {
  const absolutePath = resolve(path);
  const relativePath = relative(process.cwd(), absolutePath);

  try {
    const pathStat = await stat(absolutePath);

    if (pathStat.isDirectory()) {
      console.error(`Skipping directory: ${path} (pass files or use globs)`);
      return;
    }

    const content = await readFile(absolutePath, 'utf-8');
    const ext = path.split('.').pop() || '';

    result += `# FILE: ${relativePath}\n\n`;
    result += "```" + ext + "\n";
    result += content;
    if (!content.endsWith('\n')) result += '\n';
    result += "```\n\n---\n\n";
  } catch (e) {
    console.error(`Error reading ${path}: ${e.message}`);
  }
}

const gitignore = values['no-gitignore'] ? null : await readGitignore();
let skippedFiles = [];

for (const path of positionals) {
  // Expand globs using fast-glob
  const files = await fg.glob(path, { onlyFiles: true });

  if (files.length === 0) {
    // Try as direct file path
    try {
      const absolutePath = resolve(path);
      if (gitignore) {
        const relativePath = relative(process.cwd(), absolutePath);
        if (gitignore.ignores(relativePath)) {
          skippedFiles.push(relativePath);
          continue;
        }
      }
      await processPath(path);
    } catch {
      console.error(`Error: No files found matching '${path}'`);
    }
  } else {
    for (const file of files) {
      const relativePath = relative(process.cwd(), file);
      if (gitignore && gitignore.ignores(relativePath)) {
        skippedFiles.push(relativePath);
        continue;
      }
      await processPath(file);
    }
  }
}

if (skippedFiles.length > 0 && !values.quiet) {
  console.warn(`Warning: ${skippedFiles.length} gitignored file(s) skipped:`);
  for (const file of skippedFiles) {
    console.warn(`  ${file}`);
  }
  console.warn(`Use -i/--no-gitignore to include them, or -q/--quiet to suppress this warning.`);
}

if (values.output) {
  const outputPath = values.output;

  try {
    await access(outputPath, constants.F_OK);
    if (!values.force) {
      console.error(`Error: Output file '${outputPath}' already exists. Use -f or --force to overwrite.`);
      process.exit(1);
    }
  } catch {
    // File doesn't exist, proceed
  }
  await writeFile(outputPath, result);
  console.error(`Context written to ${outputPath}`);
} else {
  process.stdout.write(result);
}
