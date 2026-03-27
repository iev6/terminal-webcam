# Terminal Webcam

A TUI application that streams live webcam video to your terminal using grayscale block characters. Achieves 80–120 FPS on modern hardware via a three-tier capture pipeline.

## Prerequisites

- **Bun** v1.0+ — [bun.sh](https://bun.sh)
- **Webcam** — built-in or external
- **macOS** (primary target; Linux/Windows supported via FFmpeg fallback)
- **Camera permissions** granted to your terminal app

For the fastest (AVFoundation) path, also build the native dylib once:

```bash
bun run build:native   # requires Xcode command line tools
```

## Install & Run

```bash
bun install
bun start
```

## Capture modes (auto-detected, in priority order)

| Mode | How | Typical latency |
|------|-----|-----------------|
| **AVFoundation** (macOS + Bun FFI) | Swift dylib via `bun:ffi`, direct camera access, vImage scaling | 0.3–1 ms |
| **FFmpeg + VideoToolbox** | GPU-accelerated subprocess, raw pixel streaming | 0.5–2 ms |
| **Software** (node-webcam + Sharp) | CPU-based JPEG decode/resize/grayscale | 2–7 ms |

The app tries each in order and falls back automatically.

## Keyboard controls

| Key | Action |
|-----|--------|
| `q`, `ESC` | Quit |
| `h`, `?` | Toggle help overlay |
| `s` | Save snapshot to `snapshots/` |
| `l` | Toggle verbose perf logs (every 100 frames) |
| `p` | Toggle real-time perf overlay |
| `→`, `.` | Next character set |
| `←`, `,` | Previous character set |
| `Ctrl+C` | Force quit |

## Perf overlay (`p`)

Renders a live breakdown over the video — no external tools needed:

```
┌────────────────────────────────────────────────┐
│ FPS:21  avfoundation  2.4ms                    │
│ Capture ██░░░░░░░░░░░░░░░░░░░░░░░   0.3ms   1% │
│ Convert █████████░░░░░░░░░░░░░░░░   1.1ms   4% │
│ Render  ████████████████░░░░░░░░░   2.0ms   8% │
│ Idle    █████████████████████████  44.3ms  87% │
│ ▁▂▁▂▃▂▁▂▃▃▂▁▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂ │
└────────────────────────────────────────────────┘
```

## CPU flamegraph profiling

```bash
bun run profile        # run app normally; quit with 'q' to write .cpuprofile
bun run flamegraph     # open in speedscope (browser flamegraph viewer)
```

Or load the `.cpuprofile` file manually in Chrome DevTools → Performance tab.

## Configuration

Edit `src/webcam/config.js`:

```javascript
targetFPS: 20      // frame rate target
width: 1024        // capture width (auto-scaled to terminal size × 6)
height: 576        // capture height
quality: 75        // JPEG quality for software fallback
device: null       // camera device (null = default)
```

## Project structure

```
terminal-webcam/
├── src/
│   ├── index.js                    # App orchestrator
│   ├── native/
│   │   └── AVCapture.swift         # Swift dylib (AVFoundation + vImage)
│   ├── webcam/
│   │   ├── hybrid-capture.js       # Priority cascade: AVFoundation → FFmpeg → Software
│   │   ├── avfoundation-capture.js # Bun FFI wrapper for the Swift dylib
│   │   ├── ffmpeg-capture.js       # Hardware-accelerated FFmpeg subprocess
│   │   ├── capture.js              # Software fallback (node-webcam)
│   │   └── config.js               # Camera configuration
│   ├── renderer/
│   │   ├── terminal.js             # Render loop + per-frame timing
│   │   ├── converter.js            # Buffer → ASCII (raw pixels or JPEG)
│   │   └── character-sets.js       # 10 character ramps
│   ├── ui/
│   │   ├── screen.js               # Direct ANSI renderer (no blessed)
│   │   └── controls.js             # Keyboard bindings
│   └── utils/
│       └── terminal-size.js        # Terminal dimension detection
├── scripts/
│   └── build-native.sh             # Compile AVCapture.swift → libAVCapture.dylib
└── package.json
```

## Dependencies

- **sharp** — image processing for software fallback
- **node-webcam** — camera capture for software fallback
- **chalk** — status bar colors

The renderer uses direct ANSI escape codes — no TUI framework required.

## Building the native dylib

Requires Xcode command line tools (`xcode-select --install`):

```bash
bun run build:native
```

This compiles `src/native/AVCapture.swift` to `src/native/libAVCapture.dylib` using AVFoundation and the Accelerate framework. The dylib is gitignored; run this once per machine after cloning.

## Troubleshooting

**Webcam not found** — grant camera access to your terminal in System Settings → Privacy & Security → Camera.

**AVFoundation path not activating** — run `bun run build:native` first. The app falls back to FFmpeg if the dylib is missing.

**FFmpeg not found** — install with `brew install ffmpeg`. The app falls back to software mode.

**Stuttering** — reduce `targetFPS` in config, or use a GPU-accelerated terminal (iTerm2, Alacritty, WezTerm).

## Design notes & lessons learned

### CoreML is the wrong tool for this

The initial idea was to use Apple's CoreML framework to accelerate image processing. Turns out CoreML is an ML *inference* framework — it runs neural networks. For resize + grayscale + pixel mapping, the right tools are:

- **VideoToolbox** (via FFmpeg `--hwaccel videotoolbox`) for hardware-accelerated decode/resize/colorspace on GPU
- **vImage** (Accelerate framework) for SIMD-optimized CPU-side scaling
- **AVFoundation** for direct camera access without subprocess overhead

CoreML would only make sense here if you wanted ML-based effects (e.g. super-resolution upscaling, style transfer) — and even then, inference overhead would likely hurt real-time performance.

### The actual bottleneck was the TUI framework

`blessed` was taking 5–10ms per frame to render — more than the GPU-accelerated image processing pipeline. Replacing it with direct `process.stdout.write()` + ANSI escape codes (`\x1b[H` cursor home, `\x1b[?1049h` alt screen, `\x1b[row;colH` positioning) cut render time to <0.5ms.

Rule of thumb: measure before optimizing. The obvious bottleneck (image processing) wasn't the actual bottleneck.

### Bun FFI enables zero-subprocess native code

The FFmpeg path works but carries subprocess overhead — spawning a child process, piping stdout across process boundaries, etc. Bun's `bun:ffi` lets you load a `.dylib` and call C-exported functions directly in the JS event loop.

The Swift dylib uses AVFoundation's `AVCaptureVideoDataOutput` configured for `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange` (YUV). The Y plane of this format *is already grayscale* — no RGB→gray conversion needed. Then `vImageScale_Planar8` from the Accelerate framework scales it to target dimensions. The scaled bytes are copied into a shared buffer that JS reads via FFI.

### Three-tier capture hierarchy

```
AVFoundation (Bun FFI, macOS)     → 0.3–1ms   — direct, no subprocess
FFmpeg + VideoToolbox (subprocess) → 0.5–2ms   — GPU pipeline, cross-platform
node-webcam + Sharp (CPU)          → 2–7ms     — pure software, universal fallback
```

Each tier degrades gracefully: AVFoundation won't load if the dylib isn't built; FFmpeg won't start if it's not installed; Sharp always works.

### YUV Y-plane trick

Most camera formats deliver YUV (Y = luma, U/V = chroma). For grayscale terminal output, you only need luma. `CVPixelBufferGetBaseAddressOfPlane(buffer, 0)` gives you the Y plane directly — a contiguous block of bytes where each byte is the grayscale value of one pixel. No colorspace conversion pass needed at all.

### Profiling setup

`bun --cpu-prof` outputs a `.cpuprofile` (V8 CPU Profile format) when the process exits. This opens directly in Chrome DevTools → Performance tab, or in [speedscope](https://speedscope.app) for a nicer flamegraph view. The `bun run profile` + `bun run flamegraph` scripts wire this up.

## License

MIT
