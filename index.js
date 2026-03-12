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
      short: "I",
    },
    include: {
      type: "string",
      multiple: true,
      short: "i",
    },
    exclude: {
      type: "string",
      multiple: true,
      short: "e",
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
Always quote glob patterns to prevent shell expansion. Use **/* for recursive matching.

Options:
  -o, --output <file>    Save the combined output to a file instead of printing to stdout.
  -f, --force            Overwrite output file if it exists.
  -I, --no-gitignore     Ignore .gitignore patterns.
  -i, --include <pattern> Include files matching glob pattern even if gitignored.
  -e, --exclude <pattern> Exclude files matching glob pattern (repeatable).
  -g, --ignore-file <file> Use a custom ignore file with .gitignore syntax (repeatable).
  -q, --quiet            Suppress all non-essential output (warnings, errors, success messages).
  -h, --help             Show this help message.

Examples:
  fjoin file1.ts file2.ts
  fjoin "src/**/*.ts" -o combined.md
  fjoin "src/*" -I
  fjoin "src/*" -i "*.tsbuildinfo"
  fjoin "src/*" -q | pbcopy    # Quiet mode for piping to clipboard (macOS)
  fjoin "src/*" -q | xclip     # Quiet mode for piping to clipboard (Linux X11)
  fjoin "src/*" -q | wl-copy   # Quiet mode for piping to clipboard (Linux Wayland)
  fjoin "src/*" -q | clip      # Quiet mode for piping to clipboard (Windows)
  `);
  process.exit(0);
}

let resultParts = [];
let gitignorePatterns = [];
let skippedBinaryFiles = [];

async function readGitignore() {
  const ig = ignore();
  ig.add('.git/'); // Always ignore .git directory
  try {
    const gitignoreContent = await readFile('.gitignore', 'utf-8');
    // Parse and store patterns
    gitignorePatterns = gitignoreContent.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    return ig.add(gitignoreContent);
  } catch {
    // .gitignore doesn't exist, return the instance with only .git/ ignored
    return ig;
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
    if (!values.quiet) {
      console.error(`Error reading ignore file '${filePath}': ${e.message}`);
    }
    process.exit(1);
  }
}

async function processPath(absolutePath) {
  const relativePath = relative(process.cwd(), absolutePath);

  try {
    // Check if file is binary using content-based detection
    const binary = await isBinaryFile(absolutePath);
    if (binary) {
      skippedBinaryFiles.push(relativePath);
      return;
    }

    const content = await readFile(absolutePath, 'utf-8');
    const ext = relativePath.split('.').pop() || '';

    resultParts.push(`# FILE: ${relativePath}\n\n`);
    resultParts.push("```" + ext + "\n");
    resultParts.push(content);
    if (!content.endsWith('\n')) resultParts.push('\n');
    resultParts.push("```\n\n---\n\n");
  } catch (e) {
    if (!values.quiet) {
      console.error(`Error reading ${relativePath}: ${e.message}`);
    }
  }
}

const gitignore = values['no-gitignore'] ? null : await readGitignore();
const includePatterns = values.include || [];
const customIgnoreFiles = values['ignore-file'] || [];

// Use 'ignore' for both include and exclude patterns for better performance and consistency
const includeIg = ignore().add(includePatterns);
const excludeIg = ignore().add(values.exclude || []);

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

const expandedPositionals = await Promise.all(
  positionals.map(async (p) => {
    try {
      const s = await stat(resolve(p));
      if (s.isDirectory()) {
        return p.replace(/\/$/, '') + '/**/*';
      }
    } catch {
      // Not a real path — must be a glob pattern, pass through
    }
    return p;
  })
);

const allFiles = await fg.glob(expandedPositionals, {
  dot: true,
  onlyFiles: true,
  absolute: true,
  cwd: process.cwd(),
});

if (allFiles.length === 0 && positionals.length > 0 && !values.quiet) {
  console.warn("No files matched. Check that the paths or glob patterns exist.");
}

// 2. Process the unified list
for (const absolutePath of allFiles) {
  const relPath = relative(process.cwd(), absolutePath);

  // Existing gitignore check
  const isGitIgnored = gitignore ? gitignore.ignores(relPath) : false;

  // New: check all custom ignore files
  const isCustomIgnored = customIgnores.some(({ ig }) => ig.ignores(relPath));

  const isIgnored = isGitIgnored || isCustomIgnored;
  const isForceIncluded = includeIg.ignores(relPath);
  const isExcluded = excludeIg.ignores(relPath);

  if (isExcluded) {
    skippedFiles.push(relPath);
    continue;
  }

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
  console.warn(`Use -I/--no-gitignore to include them, or -i/--include <pattern> to selectively include.`);
}

const result = resultParts.join('');

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
  
  try {
    await writeFile(outputPath, result);
    if (!values.quiet) {
      console.log(`Context written to ${outputPath}`);
    }
  } catch (e) {
    if (!values.quiet) {
      console.error(`Error writing to '${outputPath}': ${e.message}`);
    }
    process.exit(1);
  }
} else {
  process.stdout.write(result);
}
