# GEMINI.md

This document provides a comprehensive overview of the Ultra project, its structure, and development guidelines to be used as instructional context for future interactions.

## Project Overview

Ultra is a terminal-native code editor built with Bun and TypeScript. It aims to provide a high-performance editing experience with modern IDE features and a user experience inspired by Sublime Text and VS Code.

**Core Features:**

*   **Advanced Text Editing:** Utilizes a piece table for efficient handling of large files, supports multi-cursor editing, word wrap, and code folding.
*   **IDE Capabilities:** Integrates syntax highlighting via Shiki, Language Server Protocol (LSP) for intelligent code completion and navigation, and Git integration for version control.
*   **Rich User Interface:** Features a file tree, integrated terminal, minimap, command palette, and a tab-based interface for managing multiple documents.
*   **Customization:** Supports VS Code-compatible keybindings and themes, with settings that can be reloaded on the fly.

**Architecture:**

The application follows an event-driven architecture with a centralized state management system. Key architectural patterns include a priority-based rendering scheduler, a `Result` type for robust error handling, and a modular design that separates core editing functionality from the UI and feature integrations.

## Building and Running

### Requirements

*   Bun v1.0 or later

### Installation

```bash
# Clone the repository
git clone https://github.com/AgeOfLearning/ultra-editor.git
cd ultra-editor

# Install dependencies
bun install
```

### Development

*   **Run in development mode:**
    ```bash
    bun run dev
    ```

*   **Open a specific file or directory:**
    ```bash
    bun run dev <path/to/file_or_directory>
    ```

*   **Run with hot reload:**
    ```bash
    bun --watch run src/index.ts
    ```

### Building

*   **Build the executable:**
    ```bash
    bun run build
    ```
    This will create an `ultra` executable in the root directory.

### Testing and Type Checking

*   **Run tests:**
    ```bash
    bun test
    ```

*   **Run tests in watch mode:**
    ```bash
    bun test --watch
    ```

*   **Check for type errors:**
    ```bash
    bun run typecheck
    ```

## Development Conventions

*   **Code Style:** The project uses TypeScript and follows standard formatting conventions. While not explicitly defined, the existing codebase should be referenced for style guidelines.
*   **Error Handling:** The project uses a `Result` type for error handling, avoiding the use of exceptions for control flow.
*   **State Management:** A centralized `editor-state.ts` is used to manage the application's state.
*   **Modularity:** The codebase is organized into modules based on functionality (e.g., `core`, `ui`, `features`).
*   **Configuration:** Configuration is handled through JSON files, compatible with VS Code's settings and theme formats.
