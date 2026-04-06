# Contributing to Focra

Thank you for your interest in contributing to Focra! We welcome contributions of all kinds — bug reports, feature requests, documentation improvements, and code changes.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this standard. Please be respectful and constructive in all interactions.

---

## Getting Started

1. [Fork](https://github.com/iamtatenda/Focra/fork) the repository on GitHub.
2. Clone your fork locally:

   ```bash
   git clone https://github.com/<your-username>/Focra.git
   cd Focra
   ```

3. Add the upstream remote:

   ```bash
   git remote add upstream https://github.com/iamtatenda/Focra.git
   ```

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/) 9 or later

### Install Dependencies

```bash
npm install
```

### Run in Development Mode

```bash
npm run dev
```

This starts the Electron app with Vite's hot module replacement (HMR) for the renderer process. Changes to renderer code reflect immediately; changes to the main process require an app restart.

### Build for Production

```bash
npm run build        # Compile TypeScript and bundle assets
npm run dist         # Package into a distributable installer
```

Packaged output lands in the `release/` directory.

---

## Project Structure

```
Focra/
├── src/
│   ├── main/                # Electron main process
│   │   ├── index.ts         # Window creation and app lifecycle
│   │   ├── ipc-handlers.ts  # IPC handlers (file save, screen sources, mouse tracking)
│   │   └── recorder.ts      # Desktop capture & auto-zoom keyframe generation
│   ├── preload/             # Secure context bridge
│   │   └── index.ts         # Exposes safe APIs to the renderer
│   └── renderer/            # React UI
│       ├── App.tsx           # Root component and page routing
│       ├── pages/
│       │   ├── RecordPage.tsx    # Recording interface
│       │   └── EditorPage.tsx    # Post-recording editor
│       ├── components/
│       │   ├── recording/        # Source selector, controls, preview
│       │   └── editor/           # Zoom editor, annotations, background, export
│       ├── store/
│       │   └── useEditorStore.ts # Zustand global state
│       └── types/                # TypeScript type definitions
├── electron-builder.yml     # Packaging configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── vite.config.ts           # Vite / electron-vite configuration
└── tsconfig.json            # TypeScript configuration
```

---

## Making Changes

1. Create a new branch from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/short-description
   ```

2. Make your changes, keeping commits focused and descriptive.

3. Keep the main process (`src/main/`) and the renderer (`src/renderer/`) changes separate where possible — they run in different contexts.

4. For security-sensitive changes (IPC handlers, file writes, preload scripts), review [Electron security best practices](https://www.electronjs.org/docs/latest/tutorial/security).

### Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/mp4-export` |
| Bug fix | `fix/<short-description>` | `fix/audio-sync` |
| Documentation | `docs/<short-description>` | `docs/contributing-guide` |
| Refactor | `refactor/<short-description>` | `refactor/zoom-algorithm` |

---

## Submitting a Pull Request

1. Sync your branch with upstream `main` before opening a PR:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. Push your branch:

   ```bash
   git push origin feat/your-feature-name
   ```

3. Open a pull request against the `main` branch of the upstream repository.

4. Fill in the PR template:
   - **What** — describe what changed and why
   - **How to test** — steps to verify your change works
   - **Screenshots** — attach before/after screenshots for UI changes

5. Address any review feedback and keep the PR up to date with `main`.

---

## Reporting Bugs

Please [open an issue](https://github.com/iamtatenda/Focra/issues/new) and include:

- Your operating system and version
- Focra version (or commit SHA)
- Steps to reproduce the bug
- What you expected to happen
- What actually happened (include console output or screenshots if relevant)

---

## Requesting Features

Feature requests are welcome! [Open an issue](https://github.com/iamtatenda/Focra/issues/new) with:

- A clear description of the feature
- The problem it solves or the use case it addresses
- Any relevant mockups or references (e.g., how similar tools implement it)

---

Thank you for helping make Focra better! 🎬
