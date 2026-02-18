#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, relative } from "node:path";
import { stat, readFile, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import fg from "fast-glob";
import ignore from "ignore";
import { isBinaryFile } from "isbinaryfile";

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
    'ignore-file': {
      type: "string",
      short: "g",
      multiple: true,
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

Usage: fjoin <files...> [options]

The <files...> argument accepts file paths or glob patterns.

Options:
  -o, --output <file>    Save the combined output to a file instead of printing to stdout.
  -f, --force            Overwrite output file if it exists.
  -i, --no-gitignore     Ignore .gitignore patterns.
  -I, --include <pattern> Include files matching glob pattern even if gitignored.
  -g, --ignore-file <file> Use a custom ignore file with .gitignore syntax (repeatable).
  -q, --quiet            Suppress gitignore warnings.
  -h, --help             Show this help message.

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
let skippedDirectories = [];
let skippedBinaryFiles = [];

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

async function readIgnoreFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const patterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return { ig: ignore().add(content), patterns };
  } catch (e) {
    console.error(`Error reading ignore file '${filePath}': ${e.message}`);
    process.exit(1);
  }
}

async function processPath(path) {
  const absolutePath = resolve(path);
  const relativePath = relative(process.cwd(), absolutePath);

  try {
    const pathStat = await stat(absolutePath);

    if (pathStat.isDirectory()) {
      skippedDirectories.push(path);
      return;
    }

    // Check if file is binary using content-based detection
    const binary = await isBinaryFile(absolutePath);
    if (binary) {
      skippedBinaryFiles.push(path);
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
const customIgnoreFiles = values['ignore-file'] || [];

// Expand include patterns to get absolute file paths
const includeFiles = new Set();
for (const pattern of includePatterns) {
  const files = await fg.glob(pattern, { onlyFiles: true });
  for (const file of files) {
    includeFiles.add(resolve(file));
  }
}

// Each entry is { ig, patterns }
const customIgnores = await Promise.all(
  customIgnoreFiles.map(f => readIgnoreFile(f))
);

// Merge all custom patterns into the global tracking arrays
for (const { patterns } of customIgnores) {
  gitignorePatterns.push(...patterns);
}

let skippedFiles = [];
let skippedPatterns = new Map();
let forceIncludedFiles = [];

// 1. Unified Globbing: Pass all positional arguments to fast-glob directly.
// This handles explicit files ("index.js") and patterns ("src/**/*.ts") identically.
const allFiles = await fg(positionals, {
  dot: true,           // Allow matching dotfiles
  onlyFiles: true,     // Ignore directories (equivalent to your manual stat check)
  absolute: true,      // Return absolute paths for easier comparison
  cwd: process.cwd(),
});

if (allFiles.length === 0 && positionals.length > 0) {
  console.warn("No files matched. Note: fjoin does not expand directories automatically. Use globs like 'src/**/*'");
}

// 2. Process the unified list
for (const absolutePath of allFiles) {
  const relPath = relative(process.cwd(), absolutePath);

  // Existing gitignore check
  const isGitIgnored = gitignore ? gitignore.ignores(relPath) : false;

  // New: check all custom ignore files
  const isCustomIgnored = customIgnores.some(({ ig }) => ig.ignores(relPath));

  const isIgnored = isGitIgnored || isCustomIgnored;
  const isForceIncluded = includeFiles.has(absolutePath);

  if (isIgnored && !isForceIncluded) {
    skippedFiles.push(relPath);

    // Pattern attribution: check gitignore patterns first, then custom
    for (const pattern of gitignorePatterns) {
      if (ignore().add(pattern).ignores(relPath)) {
        skippedPatterns.set(pattern, (skippedPatterns.get(pattern) || 0) + 1);
        break;
      }
    }
    continue;
  }

  if (isIgnored && isForceIncluded) {
    forceIncludedFiles.push(relPath);
  }

  // Process the file
  await processPath(absolutePath);
}

if (skippedDirectories.length > 0 && !values.quiet) {
  console.warn(`Warning: ${skippedDirectories.length} director${skippedDirectories.length !== 1 ? 'ies' : 'y'} skipped (pass files or use globs like 'dir/**/*'):`);
  for (const dir of skippedDirectories) {
    console.warn(`  ${dir}`);
  }
}

if (skippedBinaryFiles.length > 0 && !values.quiet) {
  console.warn(`Warning: ${skippedBinaryFiles.length} binary file(s) skipped:`);
  for (const file of skippedBinaryFiles) {
    console.warn(`  ${file}`);
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
  console.log(`Context written to ${outputPath}`);
} else {
  process.stdout.write(result);
}
