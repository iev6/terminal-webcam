# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terminal Webcam is a TUI application that streams live webcam video to the terminal using grayscale block characters. It uses a three-tier hardware acceleration pipeline and direct ANSI rendering, achieving 80-120 FPS on modern hardware.

## Commands

**Run the application:**
```bash
bun start
# or
bun src/index.js
```

**Install dependencies:**
```bash
bun install
```

**Build the native macOS dylib (required for AVFoundation path):**
```bash
bun run build:native
```

**Profile with CPU flamegraph:**
```bash
bun run profile        # run app, quit with 'q', generates .cpuprofile
bun run flamegraph     # open in speedscope
```

**Configuration:**
Edit `src/webcam/config.js` to adjust FPS, resolution, quality, and camera device.

## Architecture

### Capture Pipeline (three-tier, auto-detected)

```
Priority 1: AVFoundation (macOS + Bun FFI)
  Swift dylib → AVCaptureSession → Y-plane (grayscale) → vImageScale_Planar8 → Buffer
  Latency: 0.3–1ms

Priority 2: FFmpeg + VideoToolbox (subprocess, GPU)
  FFmpeg subprocess → Raw grayscale pixels via stdout → Buffer
  Latency: 0.5–2ms

Priority 3: Software (node-webcam + Sharp)
  node-webcam → JPEG file → Sharp resize/grayscale → Buffer
  Latency: 2–7ms
```

### Component Responsibilities

**`src/index.js` - TerminalWebcamApp**
- Application orchestrator and lifecycle manager
- Wires up capture, renderer, screen, controls
- Manages SIGINT/SIGTERM for cleanup

**`src/webcam/` - Capture System**
- `hybrid-capture.js`: Priority cascade — tries AVFoundation, then FFmpeg, then software
- `avfoundation-capture.js`: Bun FFI wrapper — loads `src/native/libAVCapture.dylib`, polls at ~60fps
- `ffmpeg-capture.js`: FFmpeg subprocess with platform GPU flags (VideoToolbox/VAAPI/DXVA2)
- `capture.js`: Software fallback (node-webcam + Sharp)
- `config.js`: Dynamic resolution (terminal size × 6 multiplier)

**`src/native/` - Swift dylib**
- `AVCapture.swift`: Exported C functions `av_capture_init/get_frame/update_resolution/stop`
- Uses `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange` — Y plane is already grayscale
- Scales with `vImageScale_Planar8` (Accelerate framework, SIMD)
- Thread-safe via `NSLock`

**`src/renderer/` - Processing Pipeline**
- `terminal.js`: Render loop, per-frame timing (capture/convert/render/total), `setPerf()` callback
- `converter.js`: Auto-detects raw pixels vs JPEG; hardware path is direct pixel-to-ASCII (<0.5ms)
- `character-sets.js`: 10 character ramps (blocks, braille, matrix, etc.)

**`src/ui/` - Terminal Interface**
- `screen.js`: Direct ANSI renderer — no TUI framework. Alt screen buffer, cursor positioning,
  status bar, help overlay, notifications, real-time perf overlay (`_renderPerfOverlay`)
- `controls.js`: Keyboard bindings via stdin raw mode

**`src/utils/terminal-size.js`**
- `getVideoBoxDimensions()`: Returns `{width: cols, height: rows - 2}` (full width, 2 rows for status bar)

### Renderer details

The screen renders by writing ANSI escape sequences directly to `process.stdout`:
- `\x1b[?1049h` — enter alt screen buffer
- `\x1b[?25l` / `\x1b[?25h` — hide/show cursor
- `\x1b[H` — cursor home (top-left, no clear; overwrites in-place each frame)
- `\x1b[row;colH` — absolute cursor position

Keyboard input is handled via `process.stdin` in raw mode. The `CompatScreen` class (inside `screen.js`) implements a minimal EventEmitter that maps raw byte sequences to blessed-style key names so `controls.js` is unchanged.

### Perf overlay

Press `p` to toggle. Rendered every frame directly over the video content:
- 8 rows tall, positioned above the status bar
- Shows: FPS, mode, per-phase timing bars (capture/convert/render/idle), sparkline history
- Data comes from `terminal.js` via `renderer.setPerf(callback)`

## Configuration Points

**Webcam Settings** (`src/webcam/config.js`):
- `targetFPS`: Frame rate target (default: 20)
- `width`, `height`: Capture resolution (default: 1024x576, auto-scaled to terminal)
- `quality`: JPEG quality for software fallback (default: 75)
- `device`: Camera device (null = default)

**Character Mapping**:
- Default ramp: ` ░▒▓█` (5 brightness levels)
- 10 ramps total, cycle with `→` / `←`

## Dependencies

- **sharp** (v0.33.x): Image processing for software fallback
- **node-webcam** (v0.8.2): Camera capture for software fallback
- **chalk** (v4.1.2): Status bar colors

No TUI framework. The `blessed` dependency was removed; rendering uses direct ANSI codes.

## Common Issues

**Camera permissions**: Grant access to your terminal in System Settings → Privacy & Security → Camera.

**AVFoundation path not activating**: Run `bun run build:native` first. Requires Xcode command line tools.

**FFmpeg not found**: `brew install ffmpeg`. App falls back to software mode automatically.

**Performance**: If stuttering occurs, reduce `targetFPS` or use a GPU-accelerated terminal (iTerm2, Alacritty, WezTerm).
