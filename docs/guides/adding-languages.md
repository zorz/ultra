# Adding Language Support Guide

This guide explains how to add support for new programming languages in Ultra.

## Overview

Language support in Ultra consists of:

1. **Syntax highlighting** - Provided by Shiki (Syntax Service)
2. **LSP features** - Go-to-definition, autocomplete, etc. (LSP Service)
3. **File association** - Mapping extensions to languages

## Syntax Highlighting

Ultra uses [Shiki](https://shiki.style/) for syntax highlighting via the Syntax Service.

### Supported Languages

Shiki supports 100+ languages out of the box. The Syntax Service preloads common languages:

- TypeScript, JavaScript, TSX, JSX
- Python, Go, Rust
- JSON, JSONC, YAML
- HTML, CSS, Markdown
- Bash, SQL

### Adding a Language to Preload

Edit `src/services/syntax/highlighter.ts`:

```typescript
const PRELOADED_LANGUAGES = [
  'typescript',
  'javascript',
  // ... existing languages
  'ruby',  // Add your language
];
```

### File Extension Mapping

The Syntax Service maps file extensions to languages. Add mappings in `src/services/syntax/local.ts`:

```typescript
private getLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const extMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    // ... existing mappings
    '.rb': 'ruby',
    '.rake': 'ruby',
  };
  return extMap[ext] ?? 'plaintext';
}
```

## LSP Support

### Prerequisites

Install the language server globally:

```bash
# TypeScript
npm install -g typescript-language-server typescript

# Python
pip install pyright

# Go
go install golang.org/x/tools/gopls@latest

# Ruby
gem install solargraph
```

### Configuring a Language Server

Add server configuration in `~/.ultra/settings.jsonc`:

```jsonc
{
  "lsp.servers": {
    "ruby": {
      "command": "solargraph",
      "args": ["stdio"],
      "filetypes": ["ruby"],
      "rootPatterns": ["Gemfile", ".ruby-version"]
    }
  }
}
```

### Configuration Options

| Option | Description |
|--------|-------------|
| `command` | Executable name or path |
| `args` | Command-line arguments |
| `filetypes` | File types to activate for |
| `rootPatterns` | Files that identify project root |
| `initializationOptions` | Server-specific options |

### Built-in Server Registration

For built-in support, add to `src/services/lsp/providers.ts`:

```typescript
const SERVER_CONFIGS: Record<string, LSPServerConfig> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    filetypes: ['typescript', 'javascript', 'tsx', 'jsx'],
    rootPatterns: ['tsconfig.json', 'package.json']
  },

  ruby: {
    command: 'solargraph',
    args: ['stdio'],
    filetypes: ['ruby'],
    rootPatterns: ['Gemfile', '.ruby-version'],
    initializationOptions: {
      formatting: true,
      diagnostics: true
    }
  }
};
```

## Complete Example: Adding Ruby Support

### 1. Add Syntax Highlighting

Ruby is supported by Shiki by default. Add to preloaded languages:

```typescript
// src/services/syntax/highlighter.ts
const PRELOADED_LANGUAGES = [
  // ... existing
  'ruby',
];
```

### 2. Add File Extension Mapping

```typescript
// src/services/syntax/local.ts
const extMap = {
  // ... existing
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.gemspec': 'ruby',
};
```

### 3. Install Language Server

```bash
gem install solargraph
```

### 4. Configure LSP

Add to `~/.ultra/settings.jsonc`:

```jsonc
{
  "lsp.servers": {
    "ruby": {
      "command": "solargraph",
      "args": ["stdio"],
      "filetypes": ["ruby"],
      "rootPatterns": ["Gemfile", ".ruby-version"]
    }
  }
}
```

## Testing Language Support

### 1. Test Syntax Highlighting

```bash
# Create test file
echo 'def hello
  puts "Hello, World!"
end' > test.rb

# Open in Ultra
bun run dev test.rb
```

### 2. Test LSP Features

1. Open a file of your language
2. Try these features:
   - Hover over symbols (`Ctrl+K`)
   - Trigger autocomplete (`Ctrl+Space`)
   - Go to definition (`F12`)
   - Find references (`Shift+F12`)

### 3. Check Debug Logs

```bash
bun run dev --debug test.rb
cat debug.log | grep -E "(LSP|Syntax)"
```

## Troubleshooting

### Syntax Highlighting Not Working

1. Check file extension mapping
2. Verify language is in PRELOADED_LANGUAGES
3. Check `debug.log` for Shiki errors

### LSP Not Connecting

1. Verify language server is installed: `which solargraph`
2. Check server configuration in settings
3. Look for errors in `debug.log`
4. Try running server manually: `solargraph stdio`

### LSP Features Missing

1. Some servers don't support all features
2. Check server capabilities in initialize response
3. Verify project has required config files

## Service Architecture

Language support uses two ECP services:

```
┌─────────────────────┐     ┌─────────────────────┐
│   Syntax Service    │     │    LSP Service      │
│  (src/services/     │     │  (src/services/     │
│   syntax/)          │     │   lsp/)             │
├─────────────────────┤     ├─────────────────────┤
│ - Shiki highlighter │     │ - LSP client mgmt   │
│ - Token generation  │     │ - Completion        │
│ - Language detect   │     │ - Hover/Definition  │
└─────────────────────┘     └─────────────────────┘
```

## Related Documentation

- [Architecture Overview](../architecture/overview.md) - ECP services
- [LSP Module](../modules/lsp.md) - LSP implementation details
