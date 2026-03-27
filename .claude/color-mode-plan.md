# Color Mode Plan

## Context
The app currently outputs only grayscale block characters. Every capture path (AVFoundation, FFmpeg, software) discards color at the source — AVFoundation throws away the CbCr chroma plane, FFmpeg uses `-pix_fmt gray`, and Sharp calls `.grayscale()`. Adding color means threading RGB24 pixels through the whole pipeline and emitting ANSI truecolor codes (`\x1b[38;2;R;G;Bm`) per character. The feature is toggled at runtime with `c` — grayscale stays the default.

## Approach
- **Format**: RGB24 (3 bytes/pixel) is the standard internal color format across all paths
- **Character selection**: luma formula `0.299R + 0.587G + 0.114B` — keeps visual texture in color mode
- **Rendering**: per-character ANSI truecolor with run-length optimization (only emit new escape when color changes); reset with `\x1b[0m` at end of each line
- **Toggle cost**: FFmpeg and AVFoundation restart their sessions on toggle (~200–500ms gap handled gracefully — renderer already skips null frames); software path needs no restart

---

## Files & Changes

### 1. `src/native/AVCapture.swift`
- Refactor `av_capture_init` body into private `_av_capture_start_session(width:height:)` helper
- Add global `private var colorMode: Bool = false`
- New export `av_capture_set_color(enabled: Int32)`: sets `colorMode`, reallocates output buffer (`w*h*3` vs `w*h`), stops + restarts session via the helper
- In `CaptureDelegate.captureOutput`: branch on `colorMode`
  - **grayscale** (existing): extract Y plane → `vImageScale_Planar8` → output 1 byte/pixel
  - **color** (new): use BGRA base address → `vImageScale_ARGB8888` into tmp buf → `vImageConvert_BGRA8888toRGB888` into output → 3 bytes/pixel
- Request `kCVPixelFormatType_32BGRA` from `videoSettings` when `colorMode == true`
- Update `av_capture_get_frame` and `av_capture_update_resolution` to multiply sizes by `colorMode ? 3 : 1`
- **Rebuild**: `bash scripts/build-native.sh` after editing

### 2. `src/renderer/converter.js`
- Add `this.colorMode = false` and `setColorMode(enabled)` method
- Extend `convertToTerminal()` format detection:
  - `length === w*h*3` → new `_rgbPixelsToAscii()` (RGB24 raw path)
  - `length === w*h` → existing `_pixelsToAscii()` (grayscale raw path, unchanged)
  - else → Sharp path
- Add `_rgbPixelsToAscii(pixelData, width, height)`:
  ```
  for each pixel: luma → charRamp index → char
  run-length: only emit \x1b[38;2;R;G;Bm when color differs from previous char
  reset \x1b[0m at end of each line
  ```
- Update `_convertWithSharp()`: skip `.grayscale()` when `this.colorMode`; if color, pass result to `_rgbPixelsToAscii()`

### 3. `src/webcam/avfoundation-capture.js`
- Add `av_capture_set_color: { args: [FFIType.i32], returns: FFIType.void }` to `dlopen` declaration
- Add `this.colorMode = false` to constructor
- `setColorMode(enabled)`: update `this.colorMode`, reallocate `frameBuffer` (`w*h*stride`), null `currentBuffer`, call `lib.symbols.av_capture_set_color(enabled ? 1 : 0)`
- Update `updateResolution()`: allocate `frameBuffer` using current `colorMode ? 3 : 1` stride

### 4. `src/webcam/ffmpeg-capture.js`
- Add `this.colorMode = false` to constructor
- `_getFFmpegArgs()`: use `this.colorMode ? 'rgb24' : 'gray'` for `-pix_fmt`
- `initialize()` and `setColorMode()`: compute `bytesPerFrame = width * height * (colorMode ? 3 : 1)`
- `setColorMode(enabled)`: set flag, recalculate `bytesPerFrame`, null `currentBuffer`, call `stop()` + `start()` if running

### 5. `src/webcam/hybrid-capture.js`
- Add `this.colorMode = false` to constructor
- `setColorMode(enabled)`: fan out to active capture only:
  - `avfoundation` → `this.avCapture.setColorMode(enabled)`
  - `hardware` → `this.ffmpegCapture.setColorMode(enabled)`
  - `software` → no-op (converter handles it)
- `saveAsImage()`: pass `channels: this.colorMode ? 3 : 1` to Sharp's `raw:` option

### 6. `src/renderer/terminal.js`
- Add `this.colorMode = false` to constructor
- Add `setColorMode(enabled)` → `this.colorMode = enabled; this.converter.setColorMode(enabled)`

### 7. `src/ui/screen.js`
- `CompatScreen._handleKey` keyMap: add `'c': 'c', 'C': 'C'`
- `Screen` constructor `this.stats`: add `colorMode: false`
- `_getStatusText()`: add `chalk.green(` ${colorMode ? 'Color' : 'Gray'} `)` segment after charset

### 8. `src/ui/controls.js`
- `setup()`: add 7th param `onToggleColor`, store it, register `screen.key(['c', 'C'], ...)`
- `getHelpText()`: add `'c          - Toggle color mode'` line

### 9. `src/index.js`
- Add `this.colorMode = false` to constructor
- Add `toggleColorMode()`:
  ```
  this.colorMode = !this.colorMode
  this.renderer.setColorMode(this.colorMode)
  this.webcam.setColorMode(this.colorMode)
  this.screen.updateStats({ colorMode: this.colorMode })
  this.screen.showNotification(`Color mode: ${this.colorMode ? 'ON' : 'OFF'}`)
  ```
- Extend `controls.setup(...)` with 7th arg: `() => this.toggleColorMode()`

---

## Implementation Order
1. `AVCapture.swift` → rebuild dylib
2. `converter.js` (purely additive, safe to test independently)
3. `avfoundation-capture.js` + `ffmpeg-capture.js` (parallel, independent)
4. `hybrid-capture.js`
5. `terminal.js`
6. `screen.js` + `controls.js` (parallel, independent)
7. `index.js` (wires everything together)

## Verification
1. `bun run build:native` — dylib builds without errors
2. `bun start` — app launches in grayscale (default unchanged)
3. Press `c` — status bar shows `Color`, feed switches to color; brief freeze during capture restart is expected
4. Press `c` again — reverts to grayscale
5. Press `s` — snapshot saves correctly in both modes (channels: 1 vs 3)
6. Press `p` — perf overlay still works in color mode
7. Arrow keys / charset cycling — character sets render in color
8. Resize terminal — color mode persists across resolution updates
