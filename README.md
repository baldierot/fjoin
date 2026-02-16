# fjoin

A simple CLI tool to combine files into a single file with clear file headers and relative paths.

## Installation

To install globally on your system:

```bash
bun install -g github:baldierot/fjoin
```

## Usage

```bash
fjoin <files...> [options]
```

### Options

- `-o, --output <file>`: Save the combined output to a file instead of printing to stdout.
- `-h, --help`: Show help message.

### Examples

Combine specific files:
```bash
fjoin index.ts package.json
```

Combine all TypeScript files in `src` and save to `combined.md`:
```bash
fjoin src/**/*.ts -o combined.md
```
