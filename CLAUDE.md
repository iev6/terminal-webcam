# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terminal Webcam is a TUI application that streams live webcam video to the terminal using grayscale block characters. It features GPU hardware acceleration (FFmpeg) with automatic fallback to software rendering (Sharp), achieving 80-120 FPS on modern hardware.

## Commands

**Run the application:**
```bash
npm start
# or
node src/index.js
```

**Install dependencies:**
```bash
npm install
```

**Configuration:**
Edit `src/webcam/config.js` to adjust FPS, resolution, quality, and camera device.

## Architecture

### High-Level System Design

The application uses a **hybrid capture system** that automatically selects between GPU-accelerated hardware rendering or optimized software rendering:

**Hardware Mode (FFmpeg with GPU acceleration):**
```
Webcam → FFmpeg (GPU) → Raw grayscale pixels → ASCII → Terminal
         ↓
   GPU handles: decode, resize, grayscale (0.5-2ms)
```

**Software Mode (Fallback):**
```
Webcam → node-webcam → Buffer → Sharp (CPU) → Raw pixels → ASCII → Terminal
                                 ↓
                         Resize, grayscale (2-5ms)
```

**Performance:**
- Hardware mode: 80-120 FPS capable (1-3ms per frame)
- Software mode: 40-60 FPS capable (2-7ms per frame)
- Automatic detection and graceful fallback

### Component Responsibilities

**`src/index.js` - TerminalWebcamApp**
- Application orchestrator and lifecycle manager
- Uses HybridCapture for automatic hardware/software selection
- Handles snapshots, stats updates, and graceful shutdown
- Manages SIGINT/SIGTERM for cleanup

**`src/webcam/` - Capture System**
- `hybrid-capture.js`: **Main capture manager**
  - Attempts FFmpeg hardware acceleration first
  - Falls back to software rendering if FFmpeg unavailable
  - Provides unified interface for both modes
  - Reports active mode to application

- `ffmpeg-capture.js`: **Hardware-accelerated capture** ⭐
  - Uses FFmpeg with platform-specific GPU acceleration
  - VideoToolbox (macOS), VAAPI (Linux), DXVA2 (Windows)
  - Streams raw grayscale pixels from stdout (no JPEG encoding)
  - GPU handles: decode, scale, color conversion
  - **0.5-2ms processing time**

- `capture.js`: **Software capture (fallback)**
  - Uses node-webcam + Sharp (CPU-based)
  - Continuous capture mode with background loop
  - In-memory buffer caching
  - **2-5ms processing time**

- `config.js`: Dynamic resolution calculation based on terminal size

**`src/renderer/` - Processing Pipeline**
- `terminal.js`: TerminalRenderer class
  - Frame scheduling using `setTimeout` at target FPS
  - Pulls latest frame buffer from capture system
  - Performance monitoring with hardware/software mode awareness
  - Tracks detailed timing: capture, processing, total
  - Logs stats every 100 frames

- `converter.js`: ImageConverter class ⭐
  - **Auto-detection**: Detects raw pixels vs JPEG buffers
  - **Hardware path**: Raw pixels already scaled & grayscale → direct to ASCII (<0.5ms)
  - **Software path**: Sharp pipeline with SIMD optimizations (2-5ms)
    - Uses `sharp.simd(true)` for CPU SIMD instructions
    - Fastest resize kernel (`nearest`)
    - Sequential read optimization
  - Character ramp: ` ░▒▓█` (5 brightness levels)
  - Array buffer optimization for ASCII conversion

**`src/ui/` - Terminal Interface**
- `screen.js`: Blessed screen setup with three components:
  - Video box (100% width, 96% height): Displays ASCII frames
  - Status bar (2 lines): Shows FPS, resolution, controls
  - Help overlay (modal): Keyboard shortcuts
  - **Batched rendering**: Uses `setImmediate()` to render once per frame cycle
- `controls.js`: Keyboard handling (q/ESC/Ctrl+C quit, h/? help, s snapshot)

**`src/utils/terminal-size.js`**
- Terminal dimension detection
- Calculates available video box space (accounts for borders/status bar)

### Key Performance Patterns

1. **Hardware Acceleration**: GPU-based decode/resize/grayscale (0.5-2ms vs 3-5ms CPU) ⭐
2. **Hybrid Architecture**: Automatic hardware detection with software fallback
3. **Dynamic Resolution**: Capture resolution scales with terminal size
4. **In-Memory Buffers**: Frames cached in memory, eliminating file read overhead
5. **Raw Pixel Streaming**: FFmpeg outputs raw grayscale (no JPEG encode/decode)
6. **SIMD Optimizations**: Sharp uses CPU SIMD instructions when available
7. **Array Buffers**: Optimized ASCII conversion with typed arrays
8. **Batched Rendering**: UI updates batched with `setImmediate()`

**Performance Gains:**
- Hardware mode: 85-90% faster than original (1-3ms per frame)
- Software mode: 65-80% faster than original (2-7ms per frame)

### Technical Implementation Details

**ES6 Modules**: Project uses `"type": "module"` in package.json

**Async Patterns**: Hybrid async/await with callbacks for frame delivery

**Graceful Shutdown**:
- Global handlers for `uncaughtException`, `unhandledRejection`
- Process signal handlers (`SIGINT`, `SIGTERM`)
- Cleanup sequence: stop renderer → stop capture → destroy screen → exit

**Snapshot System**:
- Saves to `snapshots/` directory
- Timestamp format: `snapshot-2025-12-13T17-33-07-227Z.jpg`
- Uses current frame from temp file

## Configuration Points

**Webcam Settings** (`src/webcam/config.js`):
- `targetFPS`: Frame rate target (default: 20)
- `width`, `height`: Capture resolution (default: 1024x576)
- `quality`: JPEG quality 0-100 (default: 75)
- `device`: Camera device (null = default)
- `tmpFile`: Temporary frame location (default: `/tmp/webcam-frame.jpg`)

**Rendering**:
- Frame delay: Calculated as `1000 / targetFPS`
- Terminal dimensions: Auto-detected from `process.stdout.columns/rows`
- Video box size: Terminal width-2, height-4 (accounts for UI elements)

**Character Mapping**:
- 5-level brightness ramp: ` ░▒▓█`
- Grayscale mapping divides 0-255 range into 5 bins
- Space character represents darkest pixels, full block (█) represents brightest

## Dependencies

- **node-webcam** (v0.8.2): Webcam capture interface
- **blessed** (v0.1.81): Terminal UI framework
- **sharp** (v0.33.5): High-performance image processing
- **chalk** (v4.1.2): Terminal color styling (for status/notifications)

## Common Issues

**Camera permissions**: Ensure terminal/Node.js has webcam access
- macOS: System Preferences → Security & Privacy → Camera
- Linux: Check `/dev/video*` permissions

**Performance**: If stuttering occurs:
- Reduce `targetFPS` in config (try 15 or 10)
- Lower resolution (e.g., 800x450)
- Decrease JPEG quality (try 60-70)
- Use GPU-accelerated terminal (iTerm2, Alacritty, WezTerm)
