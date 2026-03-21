#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, relative, dirname } from "node:path";
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
    verbose: {
      type: "boolean",
      short: "v",
    },
    help: {
      type: "boolean",
      short: "h",
    },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help || (positionals.length === 0 && !values.include && !values['ignore-file'])) {
  console.log(`
fjoin - A simple utility to concatenate files into a single document with clear headers and relative paths.

Usage: fjoin <files...> [options]

The <files...> argument accepts file paths or glob patterns.
Note: Explicitly provided paths/globs are treated as includes (overriding .gitignore).
Always quote glob patterns to prevent shell expansion. Use **/* for recursive matching.

Options:
  -o, --output <file>    Save the combined output to a file instead of printing to stdout.
  -f, --force            Overwrite output file if it exists.
  -I, --no-gitignore     Ignore .gitignore patterns.
  -i, --include <pattern> Include files matching glob pattern even if gitignored.
                         Takes priority over --exclude. (e.g., "*.lock").
  -e, --exclude <pattern> Exclude files matching glob pattern (repeatable).
                         (e.g., "node_modules/*" or "*.test.js").
  -g, --ignore-file <file> Use a custom ignore file with .gitignore syntax (repeatable).
  -v, --verbose          Show detailed output (warnings and success messages).
  -h, --help             Show this help message.

Examples:
  fjoin file1.ts file2.ts
  fjoin "src/**/*.ts" -o combined.md
  fjoin -i "*test*" -i "*tests*"  # Include tests even if gitignored
  fjoin . -e "*" -i "*test*"      # Exclude all EXCEPT tests
  fjoin "src/**/*" -e "*.lock"    # Exclude all .lock files recursively
  fjoin "src/*" | pbcopy          # Default is quiet, perfect for piping
  `);
  process.exit(0);
}

// Pre-check: if output file exists and --force is not specified, fail early
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
}

let resultParts = [];
let gitignorePatterns = [];
let skippedBinaryFiles = [];

async function readGitignores() {
  const gitignores = [];
  const rootIg = ignore();
  
  if (values['no-gitignore']) {
    return [{ relDir: '.', ig: rootIg, patterns: [] }];
  }

  rootIg.add('.git/'); // Always ignore .git directory by default

  try {
    const files = await fg.glob('**/.gitignore', { 
      dot: true, 
      absolute: true, 
      cwd: process.cwd(),
      ignore: ['**/node_modules/**'] 
    });

    for (const file of files) {
      const relDir = relative(process.cwd(), dirname(file));
      const content = await readFile(file, 'utf-8');
      const patterns = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      if (relDir === '' || relDir === '.') {
        rootIg.add(content);
        gitignorePatterns.push(...patterns.map(p => ({ pattern: p, relDir: '.' })));
      } else {
        gitignores.push({
          relDir,
          ig: ignore().add(content),
          patterns
        });
        gitignorePatterns.push(...patterns.map(p => ({ pattern: p, relDir })));
      }
    }
  } catch (e) {
    if (values.verbose) {
      console.error(`Error finding .gitignore files: ${e.message}`);
    }
  }

  if (!gitignores.some(g => g.relDir === '.')) {
    gitignores.push({ relDir: '.', ig: rootIg, patterns: [] });
  }

  return gitignores;
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
    if (values.verbose) {
      console.error(`Error reading ${relativePath}: ${e.message}`);
    }
  }
}

const gitignores = await readGitignores();
const includePatterns = values.include || [];

// 1. Determine positionals and implicit includes
let effectivePositionals = positionals;
if (effectivePositionals.length === 0) {
  if (includePatterns.length > 0) {
    effectivePositionals = includePatterns;
  } else {
    effectivePositionals = ['.'];
  }
}

const expandedPositionals = await Promise.all(
  effectivePositionals.map(async (p) => {
    try {
      const s = await stat(resolve(p));
      if (s.isDirectory()) {
        return p.replace(/\/$/, '') + '/**/*';
      }
      // If it's a file, it's an implicit include
      includePatterns.push(p);
    } catch {
      // Not a real path — must be a glob pattern, treat as implicit include
      includePatterns.push(p);
    }
    return p;
  })
);

const customIgnoreFiles = values['ignore-file'] || [];

// Each entry is { ig, patterns }
const customIgnores = await Promise.all(
  customIgnoreFiles.map(f => readIgnoreFile(f))
);

// Merge all custom patterns into the global tracking arrays
for (const { patterns } of customIgnores) {
  gitignorePatterns.push(...patterns.map(p => ({ pattern: p, relDir: '.' })));
}

let skippedFiles = [];
let skippedPatterns = new Map();
let forceIncludedFiles = [];

// Use 'ignore' for both include and exclude patterns for better performance and consistency
const includeIg = ignore().add(includePatterns);
const excludeIg = ignore().add(values.exclude || []);

let allFiles = await fg.glob(expandedPositionals, {
  dot: false,
  onlyFiles: true,
  absolute: true,
  cwd: process.cwd(),
});

if (values.output) {
  const absoluteOutputPath = resolve(values.output);
  allFiles = allFiles.filter(f => f !== absoluteOutputPath);
}

if (allFiles.length === 0 && positionals.length > 0 && values.verbose) {
  console.warn("No files matched. Check that the paths or glob patterns exist.");
}

// 2. Process the unified list
for (const absolutePath of allFiles) {
  const relPath = relative(process.cwd(), absolutePath);

  // Check if it should be force included (overrides everything else)
  const isForceIncluded = includeIg.ignores(relPath);
  
  if (!isForceIncluded) {
    // Check for explicit exclusion
    if (excludeIg.ignores(relPath)) {
      skippedFiles.push(relPath);
      continue;
    }

    // Check all applicable gitignores
    let isGitIgnored = false;
    for (const { relDir, ig } of gitignores) {
      if (relDir === '.' || relDir === '') {
        if (ig.ignores(relPath)) {
          isGitIgnored = true;
          break;
        }
      } else if (relPath.startsWith(relDir + '/')) {
        const subRelPath = relPath.slice(relDir.length + 1);
        if (ig.ignores(subRelPath)) {
          isGitIgnored = true;
          break;
        }
      }
    }

    // New: check all custom ignore files
    const isCustomIgnored = customIgnores.some(({ ig }) => ig.ignores(relPath));

    if (isGitIgnored || isCustomIgnored) {
      skippedFiles.push(relPath);

      // Pattern attribution: check gitignore patterns first, then custom
      let attributed = false;
      for (const { pattern, relDir } of gitignorePatterns) {
        const ig = ignore().add(pattern);
        if (relDir === '.' || relDir === '') {
          if (ig.ignores(relPath)) {
            skippedPatterns.set(pattern, (skippedPatterns.get(pattern) || 0) + 1);
            attributed = true;
            break;
          }
        } else if (relPath.startsWith(relDir + '/')) {
          const subRelPath = relPath.slice(relDir.length + 1);
          if (ig.ignores(subRelPath)) {
            skippedPatterns.set(`${relDir}/${pattern}`, (skippedPatterns.get(pattern) || 0) + 1);
            attributed = true;
            break;
          }
        }
      }
      
      if (!attributed) {
         // Check custom ignores if not attributed to gitignore
         for (const { patterns } of customIgnores) {
           for (const pattern of patterns) {
             if (ignore().add(pattern).ignores(relPath)) {
               skippedPatterns.set(pattern, (skippedPatterns.get(pattern) || 0) + 1);
               attributed = true;
               break;
             }
           }
           if (attributed) break;
         }
      }
      continue;
    }
  }

  if (isForceIncluded) {
    forceIncludedFiles.push(relPath);
  }

  // Process the file
  await processPath(absolutePath);
}

if (skippedBinaryFiles.length > 0 && values.verbose) {
  console.warn(`Warning: ${skippedBinaryFiles.length} binary file(s) skipped:`);
  for (const file of skippedBinaryFiles) {
    console.warn(`  ${file}`);
  }
}

if (forceIncludedFiles.length > 0 && values.verbose) {
  console.warn(`${forceIncludedFiles.length} gitignored file(s) included via --include.`);
}

if (skippedFiles.length > 0 && values.verbose) {
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
    await writeFile(outputPath, result);
    if (values.verbose) {
      console.log(`Context written to ${outputPath}`);
    }
  } catch (e) {
    console.error(`Error writing to '${outputPath}': ${e.message}`);
    process.exit(1);
  }
} else {
  process.stdout.write(result);
}
