# Focra — Development Guide

This document covers the architecture, IPC security model, and key algorithms used in Focra. It is intended for contributors who want to understand the internals before making changes.

---

## Architecture Overview

Focra is built on [Electron](https://www.electronjs.org/) with a strict process separation:

```
┌─────────────────────────────┐
│        Main Process         │  Node.js + Electron APIs
│  ┌───────────┐  ┌────────┐  │  - Window management
│  │ ipc-      │  │recorder│  │  - Desktop capture
│  │ handlers  │  │  .ts   │  │  - File system writes
│  └───────────┘  └────────┘  │  - Mouse event tracking
└────────────┬────────────────┘
             │  IPC (contextBridge)
┌────────────▼────────────────┐
│       Preload Script        │  Sandboxed bridge
│      (index.ts)             │  - Exposes safe APIs only
└────────────┬────────────────┘
             │
┌────────────▼────────────────┐
│     Renderer Process        │  React 18 + Vite
│  ┌───────────┐  ┌────────┐  │  - All UI components
│  │RecordPage │  │Editor  │  │  - Zustand state
│  └───────────┘  │ Page   │  │  - No Node.js access
│                 └────────┘  │
└─────────────────────────────┘
```

The renderer runs with `contextIsolation: true` and `sandbox: true` — it has **no access** to Node.js APIs and communicates with the main process exclusively through the preload bridge.

---

## IPC Security Model

Focra uses a **one-time token pattern** for file saves to prevent the renderer from writing to arbitrary file paths:

1. Renderer calls `window.electron.showSaveDialog()` — the main process opens the native save dialog and returns a UUID token (not a path).
2. Renderer calls `window.electron.saveFile(token, data)` — the main process looks up the token, retrieves the saved path, writes the file, then immediately invalidates the token.

This ensures that even if the renderer were compromised, it cannot instruct the main process to write to arbitrary locations.

---

## Key Algorithms

### Auto-Zoom Keyframe Generation (`src/main/recorder.ts`)

The auto-zoom algorithm processes the list of mouse events collected during recording:

1. **Dwell detection** — events are grouped into dwell windows. A dwell is a sequence of consecutive events where the cursor stays within an 8-pixel radius for at least 500 ms.
2. **Anchor extraction** — the centroid of each dwell window becomes a zoom anchor (x, y as fractions of screen dimensions).
3. **Overlap pruning** — adjacent keyframes that are too close in time are merged or removed to avoid rapid back-to-back zooms.
4. **Keyframe creation** — each anchor is wrapped in a `ZoomKeyframe` object with configurable scale, easing, and optional motion blur.

**Sensitivity** (0.1–1.0) scales the minimum dwell duration threshold, so a lower sensitivity value = more keyframes (picks up shorter dwells).

### Dual-Audio Mixing (`src/renderer/pages/RecordPage.tsx`)

Microphone and system audio are captured as separate `MediaStream` tracks and merged using the Web Audio API:

```
Mic stream  ──→ AudioNode ──→ MediaStreamDestination
                               (merged stream)
System stream ──→ AudioNode ──/
```

The merged stream is then fed into the `MediaRecorder` alongside the video track, producing a single interleaved audio channel in the output WebM file.

---

## State Management

Global editor state lives in `src/renderer/store/useEditorStore.ts` (Zustand). The store holds:

- `videoBlob` — raw recorded video
- `zoomKeyframes` — array of zoom events with timestamps
- `annotations` — text and arrow overlays
- `trimIn` / `trimOut` — clip boundaries (in seconds)
- `background` — background configuration
- `cropRect` — normalized crop coordinates (0–1)
- `exportSettings` — resolution, aspect ratio, frame rate

---

## Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron with Vite HMR (renderer hot-reloads; main process restarts on change) |
| `npm run build` | Compile TypeScript and bundle all processes into `out/` |
| `npm run preview` | Preview the production build |
| `npm run dist` | Build + package into a distributable installer (`release/`) |

---

## Adding a New IPC Handler

1. Define the handler in `src/main/ipc-handlers.ts` using `ipcMain.handle('channel-name', ...)`.
2. Expose it through the preload in `src/preload/index.ts` via `contextBridge.exposeInMainWorld`.
3. Add the TypeScript type signature in `src/renderer/types/electron.d.ts`.
4. Call `window.electron.yourNewMethod()` from the renderer.

Follow the existing one-time token pattern for any handler that performs file system writes.

---

## Technology Decisions

| Decision | Rationale |
|----------|-----------|
| Electron | Cross-platform desktop, access to `desktopCapturer` and file system |
| Vite + electron-vite | Fast HMR in development, optimized production bundles |
| React 18 | Concurrent rendering, large ecosystem, familiar to most contributors |
| Tailwind CSS | Utility-first, zero runtime overhead, consistent design tokens |
| Zustand | Minimal boilerplate state management without Redux complexity |
| WebM (VP9) | Native browser codec, no FFmpeg binary required |
