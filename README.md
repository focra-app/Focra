<div align="center">

# Focra

**The free, open-source screen recorder that makes your recordings look intentional.**

A cross-platform alternative to Screen Studio — with auto-zoom, annotations, background customization, and export — for free.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](https://github.com/iamtatenda/Focra/releases)
[![Version](https://img.shields.io/badge/version-0.1.0-orange)](https://github.com/iamtatenda/Focra/releases)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/UI-React%2018-61DAFB?logo=react)](https://react.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Download](#download) · [Features](#features) · [Getting Started](#getting-started) · [Contributing](CONTRIBUTING.md) · [Roadmap](#roadmap)

</div>

---

## What is Focra?

Focra is a **free and open-source screen recording application** built with Electron and React. It automatically generates smooth zoom animations based on where your cursor dwells, adds professional polish to tutorial videos, product demos, and developer walkthroughs — without any manual keyframing.

> Think Screen Studio, but free, open-source, and cross-platform.

### Who is it for?

- 👩‍💻 **Developers** recording code walkthroughs or API demos
- 🎓 **Educators** creating tutorial or course videos
- 🚀 **Makers** showcasing products or features
- 📣 **Teams** making internal screencasts and documentation

---

## Features

### 🎬 Recording
- **Multi-source capture** — record any screen or window
- **Dual-audio mixing** — microphone + system audio in one stream (Web Audio API)
- **Pause & resume** — with accurate timing that excludes paused intervals
- **Auto-zoom** — detects natural cursor dwell points (≥500 ms stable) and generates smooth zoom keyframes automatically
  - Configurable sensitivity (0.1 – 1.0)
  - Easing options: ease-in-out, ease-in, ease-out, linear
  - Adjustable scale factor (default 2×)
  - Optional motion blur

### ✂️ Editing
- **Zoom keyframe editor** — add, modify, and delete zoom animations
- **Text annotations** — add styled text overlays at any point in the timeline
- **Arrow annotations** — draw directional arrows to highlight UI elements
- **Trim** — set in/out points to remove unwanted segments
- **Background customization** — solid color, gradient, or image backgrounds
- **Crop** — define the visible area with normalized coordinates

### 📤 Export
- **Resolutions**: 720p, 1080p, 1440p, 4K
- **Aspect ratios**: 16:9, 4:3, 1:1, 9:16
- **Frame rates**: 30 fps or 60 fps
- **Format**: WebM (VP9 + Opus)
- **Native save dialog** with secure, token-based file writes

### 🖥️ Platform Support
| Platform | Installer |
|----------|-----------|
| macOS    | `.dmg`, `.zip` |
| Windows  | NSIS installer, `.zip` |
| Linux    | AppImage, `.deb` |

---

## Download

> **Note:** Focra is currently in early development (v0.1.0). Pre-built binaries will be available on the [Releases](https://github.com/iamtatenda/Focra/releases) page.

To run Focra today, follow the [Getting Started](#getting-started) guide to build from source.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/) 9 or later
- [Git](https://git-scm.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/iamtatenda/Focra.git
cd Focra

# Install dependencies
npm install
```

### Development

```bash
# Start the development server with hot reload
npm run dev
```

### Build

```bash
# Build for production
npm run build

# Package into a distributable installer
npm run dist
```

The packaged app will appear in the `release/` directory.

---

## How It Works

Focra's **auto-zoom** algorithm tracks your cursor during recording. When the cursor stays within an 8-pixel radius for at least 500 ms, that position is registered as a "dwell point" — a natural moment of interaction. After recording, Focra generates smooth zoom keyframes centered on each dwell point, giving your video a polished, intentional feel with zero manual effort.

The editor lets you review, adjust, or remove any auto-generated keyframe, add text/arrow annotations, customize the background, trim the clip, and export at your desired resolution.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 41 |
| Build tool | electron-vite + Vite 6 |
| UI | React 18 + TypeScript |
| Styling | Tailwind CSS 3 |
| State | Zustand |
| Icons | Lucide React |
| Packaging | electron-builder |

---

## Roadmap

- [ ] Pre-built release binaries for macOS, Windows, and Linux
- [ ] MP4 (H.264/AAC) export support
- [ ] Custom zoom easing curves
- [ ] Cursor highlight and click effects
- [ ] Project save/load (`.focra` project format)
- [ ] Plugin / theme system
- [ ] GIF export

---

## Contributing

Contributions are welcome! Whether it's a bug report, feature request, or pull request — please check out the [Contributing Guide](CONTRIBUTING.md) to get started.

---

## License

Focra is released under the [MIT License](LICENSE). Free to use, modify, and distribute.

---

<div align="center">
Made with ❤️ by the Focra contributors
</div>
