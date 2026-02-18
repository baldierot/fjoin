# fjoin

A simple CLI tool to combine files into a single file with clear file headers and relative paths.

## Installation

To install globally on your system:

```bash
npm install -g github:baldierot/fjoin
```

## Usage

```bash
fjoin <files...> [options]
```

### Options

- `-o, --output <file>`: Save the combined output to a file instead of printing to stdout.
- `-f, --force`: Overwrite output file if it exists.
- `-i, --no-gitignore`: Ignore .gitignore patterns.
- `-I, --include <pattern>`: Include files matching pattern even if gitignored.
- `-q, --quiet`: Suppress gitignore warnings.
- `-h, --help`: Show help message.

### Examples

Combine specific files:
```bash
fjoin index.ts package.json
```

Combine all TypeScript files in `src` and save to `combined.md`:
```bash
fjoin src/**/*.ts --output combined.md
```

Include files that are ignored by .gitignore:
```bash
fjoin src/* --no-gitignore
```

Selectively include gitignored files:
```bash
fjoin src/* --include "*.tsbuildinfo"
```

Suppress gitignore warnings:
```bash
fjoin src/* --quiet
```
