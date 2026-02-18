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
    include: {
      type: "string",
      multiple: true,
      short: "I",
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
  -I, --include <pat>    Include files matching pattern even if gitignored
  -q, --quiet            Suppress gitignore warnings
  -h, --help             Show this help message

Examples:
  fjoin file1.ts file2.ts
  fjoin src/*.ts -o combined.md
  fjoin src/* -i
  fjoin src/* -I "*.tsbuildinfo"
  `);
  process.exit(0);
}

let result = "";
let gitignorePatterns = [];

async function readGitignore() {
  try {
    const gitignoreContent = await readFile('.gitignore', 'utf-8');
    // Parse and store patterns
    gitignorePatterns = gitignoreContent.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
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
const includePatterns = values.include || [];

// Expand include patterns to get absolute file paths
const includeFiles = new Set();
for (const pattern of includePatterns) {
  const files = await fg.glob(pattern, { onlyFiles: true });
  for (const file of files) {
    includeFiles.add(resolve(file));
  }
}

let skippedFiles = [];
let skippedPatterns = new Map();
let forceIncludedFiles = [];

for (const path of positionals) {
  // Check if path is a glob pattern or an absolute file
  const isGlob = path.includes('*') || path.includes('?') || path.includes('[');
  const absolutePath = resolve(path);

  if (isGlob) {
    // Expand globs using fast-glob
    const files = await fg.glob(path, { onlyFiles: true });

    for (const file of files) {
      const absPath = resolve(file);
      const relPath = relative(process.cwd(), file);
      if (gitignore && !includeFiles.has(absPath) && gitignore.ignores(relPath)) {
        skippedFiles.push(relPath);
        // Track which pattern caused this file to be skipped
        for (const pattern of gitignorePatterns) {
          const filter = ignore().add(pattern).createFilter();
          if (!filter(relPath)) {
            skippedPatterns.set(pattern, (skippedPatterns.get(pattern) || 0) + 1);
            break;
          }
        }
        continue;
      } else if (gitignore && includeFiles.has(absPath) && gitignore.ignores(relPath)) {
        // File was gitignored but force-included
        forceIncludedFiles.push(relPath);
      }
      await processPath(file);
    }
  } else {
    // Process as direct file path
    try {
      if (gitignore) {
        const relPath = relative(process.cwd(), absolutePath);
        if (!includeFiles.has(absolutePath) && gitignore.ignores(relPath)) {
          skippedFiles.push(relPath);
          // Track which pattern caused this file to be skipped
          for (const pattern of gitignorePatterns) {
            const filter = ignore().add(pattern).createFilter();
            if (!filter(relPath)) {
              skippedPatterns.set(pattern, (skippedPatterns.get(pattern) || 0) + 1);
              break;
            }
          }
          continue;
        } else if (includeFiles.has(absolutePath) && gitignore.ignores(relPath)) {
          // File was gitignored but force-included
          forceIncludedFiles.push(relPath);
        }
      }
      await processPath(path);
    } catch (e) {
      console.error(`Error: ${e.message}`);
    }
  }
}

if (forceIncludedFiles.length > 0 && !values.quiet) {
  console.warn(`${forceIncludedFiles.length} gitignored file(s) included via --include.`);
}

if (skippedFiles.length > 0 && !values.quiet) {
  console.warn(`Warning: ${skippedFiles.length} gitignored file(s) skipped:`);
  for (const [pattern, count] of skippedPatterns) {
    console.warn(`  ${pattern} (${count} file${count !== 1 ? 's' : ''})`);
  }
  console.warn(`Use -i/--no-gitignore to include them, or -I/--include <pattern> to selectively include.`);
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
