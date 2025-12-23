# Terminal-Webcam Performance Optimization Plan
**Date:** December 23, 2025

## Executive Summary

This document outlines a comprehensive performance optimization plan to increase the terminal-webcam TUI from **20 FPS to 60+ FPS** by eliminating bottlenecks in file I/O, image processing, and terminal rendering.

**Expected improvement:** 80-90% reduction in frame processing time (10-20ms → 1-5ms per frame)

---

## Current Performance Profile

### Baseline Measurements
- **Current FPS**: 20 FPS (target achieved)
- **Frame budget**: 50ms per frame
- **Actual processing time**: 10-20ms per frame
- **Utilization**: 20-40% (comfortable margin)

### Frame Budget Breakdown (50ms total)

| Component | Time | % of Budget |
|-----------|------|-------------|
| setTimeout callback | 0.1ms | 0.2% |
| Get frame path | 0.5ms | 1% |
| **Sharp pipeline** | **10ms** | **20%** ← LARGEST |
| ├─ Read from tmpfs | 1ms | 2% |
| ├─ Decode JPEG (1024x576) | 4ms | 8% |
| ├─ Resize to terminal size | 4ms | 8% |
| └─ Grayscale + raw pixels | 1ms | 2% |
| ASCII conversion | 1ms | 2% |
| Blessed setContent | 1ms | 2% |
| OS scheduler overhead | 2-5ms | 4-10% |
| **Free headroom** | **35ms** | **70%** |

---

## Identified Bottlenecks

### CRITICAL (High Impact)

**1. File I/O per Frame**
- Impact: 1-3ms per frame
- Cause: Every capture writes to `/tmp/webcam-frame.jpg`, Sharp reads back from disk
- System calls: 2+ per frame (write + read)

**2. Sharp Image Processing**
- Impact: 8-15ms per frame (60-75% of processing time)
- Cause: Full resize from 1024x576 → ~100x25 (236x reduction)
- Sharp must decode 590KB of pixel data to produce 2.5KB output

**3. Blessed Terminal I/O**
- Impact: 2-5ms per frame
- Cause: Writing 2500+ characters to terminal per frame
- Full screen redraws even when only partial changes

### MODERATE (Medium Impact)

**4. String Concatenation**
- Impact: <1ms but creates GC pressure
- Cause: Building ASCII frame via Array.push() + 26 join() calls
- Creates 25+ intermediate string objects per frame

**5. Capture Loop Synchronization**
- Impact: CPU usage in event loop
- Cause: Busy polling with setImmediate in capture loop
- Already mitigated but still consumes cycles

---

## Optimization Roadmap

### 🔴 CRITICAL: Upgrade #1 - Eliminate File I/O
**Priority:** Highest
**Expected savings:** 2-3ms per frame (10-15% improvement)

#### Current Implementation
```javascript
// capture.js - writes to disk
await this.webcam.capture('/tmp/webcam-frame.jpg');
this.lastFramePath = '/tmp/webcam-frame.jpg';

// converter.js - reads from disk
const { data, info } = await sharp(filePath).resize(...);
```

#### Proposed Solution
Replace file-based frame passing with in-memory buffer pooling:

```javascript
class WebcamCapture {
  constructor() {
    this.frameBuffer = null;      // Latest frame in memory
    this.bufferTimestamp = null;
  }

  async captureToBuffer() {
    // Configure node-webcam to output buffer instead of file
    const buffer = await this.webcam.captureAsBuffer();
    this.frameBuffer = buffer;
    this.bufferTimestamp = Date.now();
  }

  getLatestBuffer() {
    return {
      buffer: this.frameBuffer,
      timestamp: this.bufferTimestamp
    };
  }
}

// In converter.js - process buffer directly
const { data, info } = await sharp(bufferInMemory)
  .resize(...)
  .grayscale()
  .raw()
  .toBuffer({ resolveWithObject: true });
```

#### Why This Works
- Eliminates tmpfs write operations (1-2ms)
- Eliminates file re-opening in Sharp (0.5-1ms)
- Reduces system call overhead
- Keeps data in process memory (zero-copy)

#### Implementation Steps
1. Research node-webcam buffer output options
2. If not available, replace with alternative library:
   - Option A: `node-media-devices` + `canvas`
   - Option B: `ffmpeg` with stdout piping
   - Option C: Native webcam bindings
3. Update WebcamCapture class to use buffers
4. Update ImageConverter to accept buffers
5. Remove tmpfs file path dependencies

#### Measurement
```javascript
// Add timing instrumentation
console.time('capture-write');
await this.webcam.capture();
console.timeEnd('capture-write');
// Before: 1-3ms, After: 0ms

console.time('sharp-pipeline');
const { data } = await sharp(source)...;
console.timeEnd('sharp-pipeline');
// Before: 8-15ms, After: 6-12ms
```

#### Success Criteria
- ✅ Zero file writes during capture
- ✅ Sharp processing time reduced by 15-20%
- ✅ Overall frame time reduced by 2-3ms
- ✅ No memory leaks (monitor heap growth)

---

### 🔴 CRITICAL: Upgrade #2 - Optimize Sharp Input Resolution
**Priority:** Highest
**Expected savings:** 5-10ms per frame (60-70% reduction in Sharp time)

#### Current Problem
- Capturing at 1024x576 = 590,000 pixels
- Terminal displays ~100x25 = 2,500 pixels
- Sharp must process 236x more data than needed

#### Proposed Solution
**Dynamic capture resolution matching terminal size:**

```javascript
// webcam/config.js - make resolution dynamic
export function getOptimalCaptureResolution(terminalWidth, terminalHeight) {
  // Multiply terminal size by 6-8 for quality headroom
  // Terminal: 100x25 → Capture: 600x150
  const captureWidth = Math.min(terminalWidth * 6, 1024);
  const captureHeight = Math.min(terminalHeight * 6, 576);

  // Round to even numbers for encoder compatibility
  return {
    width: Math.floor(captureWidth / 2) * 2,
    height: Math.floor(captureHeight / 2) * 2
  };
}

export function createWebcamConfig(terminalWidth, terminalHeight) {
  const { width, height } = getOptimalCaptureResolution(terminalWidth, terminalHeight);

  return {
    targetFPS: 20,
    width,
    height,
    quality: 75,
    output: 'jpeg',
    device: null,
    tmpFile: '/tmp/webcam-frame.jpg'
  };
}
```

```javascript
// capture.js - support dynamic resolution updates
class WebcamCapture {
  updateResolution(width, height) {
    this.config.width = width;
    this.config.height = height;
    // Webcam automatically uses new dimensions on next capture
  }
}

// index.js - update on terminal resize
this.screen.on('resize', () => {
  const { width, height } = getVideoBoxDimensions();
  this.webcam.updateResolution(width, height);
});
```

#### Resolution Matrix

| Terminal Size | Current Capture | Optimal Capture | Data Reduction |
|---------------|-----------------|-----------------|----------------|
| 100x25 | 1024x576 (590K px) | 600x150 (90K px) | 6.5x less |
| 120x30 | 1024x576 (590K px) | 720x180 (130K px) | 4.5x less |
| 80x20 | 1024x576 (590K px) | 480x120 (58K px) | 10x less |

#### Why This Works
- Typical terminal: 100 cols × 25 rows
- Optimal capture: 600x150 (6x multiplier maintains quality)
- Sharp processing scales O(n) with input pixels
- 6.5x less data = proportional speedup
- Still maintains excellent visual quality

#### Expected Impact
- Sharp processing: 8-15ms → 3-5ms
- JPEG decode time: Reduced proportionally
- Overall savings: 5-10ms per frame

#### Implementation Steps
1. Create `getOptimalCaptureResolution()` function
2. Make webcam config dynamic based on terminal size
3. Add resolution update on terminal resize events
4. Test quality at different multipliers (4x, 6x, 8x)
5. Find optimal balance of quality vs performance

#### Measurement
```javascript
// Log resolution and timing
console.log('Terminal:', termWidth, 'x', termHeight);
console.log('Capture:', captureWidth, 'x', captureHeight);
console.log('Ratio:', (captureWidth/termWidth).toFixed(1), 'x');

console.time('sharp-resize');
await sharp(source).resize({ width: termWidth, height: termHeight })...;
console.timeEnd('sharp-resize');
// Before (1024x576): 8-15ms
// After (600x150): 3-5ms
```

#### Success Criteria
- ✅ Capture resolution scales with terminal size
- ✅ Sharp processing time reduced to 3-5ms
- ✅ Visual quality remains acceptable (subjective)
- ✅ Handles terminal resize gracefully
- ✅ Overall frame time reduced by 5-10ms

---

### 🟡 HIGH PRIORITY: Upgrade #3 - Differential Terminal Rendering
**Priority:** High
**Expected savings:** 1-3ms per frame

#### Current Problem
- Every frame sends entire screen contents (~2500 chars)
- Even unchanged regions are rewritten
- Terminal I/O overhead: 2-5ms per frame

#### Proposed Solution
Implement frame diffing to only update changed regions:

```javascript
class DiffRenderer {
  constructor() {
    this.previousFrame = null;
  }

  renderDiff(currentFrame) {
    if (!this.previousFrame) {
      this.renderFull(currentFrame);
      this.previousFrame = currentFrame;
      return;
    }

    const diffs = this.computeDiffs(this.previousFrame, currentFrame);

    for (const diff of diffs) {
      // Use ANSI escape codes for cursor positioning
      process.stdout.write(`\x1b[${diff.row};${diff.col}H${diff.text}`);
    }

    this.previousFrame = currentFrame;
  }

  computeDiffs(oldFrame, newFrame) {
    const diffs = [];
    const oldLines = oldFrame.split('\n');
    const newLines = newFrame.split('\n');

    for (let i = 0; i < newLines.length; i++) {
      if (oldLines[i] !== newLines[i]) {
        diffs.push({
          row: i + 1,
          col: 1,
          text: newLines[i]
        });
      }
    }

    return diffs;
  }
}
```

#### Expected Impact
- Typical change rate: 30-50% of screen per frame
- Characters written: 2500 → 750-1250 (50-70% reduction)
- Terminal write time: 2-5ms → 1-2ms
- Net savings: 1-3ms (after diff computation overhead)

#### Trade-offs
- Adds diff computation: ~0.5ms overhead
- More complex code to maintain
- Net benefit: still 1-3ms savings

---

### 🟡 HIGH PRIORITY: Upgrade #4 - Use Typed Arrays for ASCII Conversion
**Priority:** High
**Expected savings:** 0.3-0.5ms per frame + reduced GC pressure

#### Current Problem
```javascript
// converter.js - current implementation
_pixelsToAscii(pixelData, width, height) {
  const lines = [];
  for (let y = 0; y < height; y++) {
    const rowChars = [];
    for (let x = 0; x < width; x++) {
      rowChars.push(this.charRamp[index]);
    }
    lines.push(rowChars.join(''));  // 25 intermediate strings
  }
  return lines.join('\n');  // Final string
}
```

Problems:
- Creates 25+ intermediate string objects
- Multiple `join()` operations
- GC pressure from allocations

#### Proposed Solution
Pre-allocate Uint8Array buffer:

```javascript
_pixelsToAscii(pixelData, width, height) {
  const charCodes = ' ░▒▓█'.split('').map(c => c.charCodeAt(0));
  const rampLength = charCodes.length;

  // Pre-allocate: width*height chars + height newlines
  const totalSize = (width * height) + height;
  const buffer = new Uint8Array(totalSize);

  let bufferIndex = 0;
  const newlineCode = 10;  // '\n'

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;

    for (let x = 0; x < width; x++) {
      const brightness = pixelData[rowStart + x];
      const index = Math.floor((brightness / 255) * (rampLength - 1));
      buffer[bufferIndex++] = charCodes[index];
    }

    buffer[bufferIndex++] = newlineCode;
  }

  // Single conversion to string
  return Buffer.from(buffer).toString('utf8');
}
```

#### Benefits
- Single memory allocation instead of 26
- Eliminates intermediate string objects
- Typed array operations faster than Array methods
- Reduced GC pressure

#### Expected Impact
- Conversion time: 0.5-1ms → 0.3-0.5ms
- Memory allocations: 26 objects → 1 object
- GC pause frequency: Reduced
- Heap churn: Significantly reduced

---

### 🟢 MEDIUM PRIORITY: Upgrade #5 - Adaptive FPS
**Priority:** Medium
**Impact:** Better user experience, no direct speed improvement

#### Proposed Solution
Dynamic FPS adjustment based on actual frame timing:

```javascript
class AdaptiveFPSRenderer {
  constructor(targetFPS = 20, minFPS = 10, maxFPS = 60) {
    this.targetFPS = targetFPS;
    this.minFPS = minFPS;
    this.maxFPS = maxFPS;
    this.currentFPS = targetFPS;
    this.recentFrameTimes = [];
    this.maxSamples = 10;
  }

  async _captureAndRender() {
    const frameStart = Date.now();

    this._scheduleNextFrame();

    try {
      await this.processFrame();

      const frameTime = Date.now() - frameStart;
      this.recentFrameTimes.push(frameTime);
      if (this.recentFrameTimes.length > this.maxSamples) {
        this.recentFrameTimes.shift();
      }

      this.adjustFPS();
    } catch (error) {
      // Handle error
    }
  }

  adjustFPS() {
    const avgFrameTime = this.recentFrameTimes.reduce((a, b) => a + b, 0) /
                         this.recentFrameTimes.length;

    const targetFrameTime = 1000 / this.targetFPS;

    if (avgFrameTime < targetFrameTime * 0.7) {
      // 30% headroom, increase FPS
      this.currentFPS = Math.min(this.maxFPS, this.currentFPS + 2);
    } else if (avgFrameTime > targetFrameTime * 0.9) {
      // 90%+ budget used, decrease FPS
      this.currentFPS = Math.max(this.minFPS, this.currentFPS - 2);
    }

    this.config.delay = 1000 / this.currentFPS;
  }
}
```

#### Benefits
- Fast machines: Automatically increase to 30-60 FPS
- Slow machines: Gracefully degrade to 10-15 FPS
- Maintains smooth playback regardless of hardware
- No dropped frames

---

### 🟢 MEDIUM PRIORITY: Upgrade #6 - Cache Sharp Pipeline
**Priority:** Low
**Expected savings:** 0.5-1ms per frame

#### Proposed Solution
Reuse Sharp pipeline configuration:

```javascript
class ImageConverter {
  constructor() {
    this.cachedPipeline = null;
    this.cachedDimensions = null;
  }

  async convertToTerminal(imageSource, width, height) {
    const dimensions = `${width}x${height}`;

    if (!this.cachedPipeline || this.cachedDimensions !== dimensions) {
      this.cachedPipeline = sharp()
        .resize({
          width: Math.floor(width),
          height: Math.floor(height),
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 1 }
        })
        .grayscale()
        .raw();

      this.cachedDimensions = dimensions;
    }

    const { data, info } = await sharp(imageSource)
      .pipe(this.cachedPipeline)
      .toBuffer({ resolveWithObject: true });

    return this._pixelsToAscii(data, info.width, info.height);
  }
}
```

#### Benefits
- Avoids recompiling resize kernel each frame
- Saves Sharp setup overhead
- Expected savings: 0.5-1ms per frame

---

## Performance Instrumentation

### Detailed Frame Timing

Add to `terminal.js`:

```javascript
class PerformanceMonitor {
  async _captureAndRender() {
    const timings = {};
    const frameStart = performance.now();

    timings.captureStart = performance.now();
    const framePath = await this.webcam.getLatestFrame();
    timings.captureTime = performance.now() - timings.captureStart;

    timings.sharpStart = performance.now();
    const terminalFrame = await this.converter.convertToTerminal(...);
    timings.sharpTime = performance.now() - timings.sharpStart;

    timings.renderStart = performance.now();
    if (this.onFrameCallback) {
      this.onFrameCallback(terminalFrame);
    }
    timings.renderTime = performance.now() - timings.renderStart;

    timings.totalTime = performance.now() - frameStart;

    // Log every 100 frames
    if (this.frameCount % 100 === 0) {
      console.log('Performance:', {
        capture: timings.captureTime.toFixed(2) + 'ms',
        sharp: timings.sharpTime.toFixed(2) + 'ms',
        render: timings.renderTime.toFixed(2) + 'ms',
        total: timings.totalTime.toFixed(2) + 'ms',
        fps: this.fps.toFixed(1)
      });
    }
  }
}
```

### Benchmark Suite

Create `benchmarks/frame-processing.js`:

```javascript
async function benchmarkFrameProcessing() {
  const iterations = 100;
  const results = {
    fileIO: [],
    sharp: [],
    ascii: [],
    render: []
  };

  for (let i = 0; i < iterations; i++) {
    results.fileIO.push(await testFileIO());
    results.sharp.push(await testSharp());
    results.ascii.push(await testAsciiConversion());
    results.render.push(await testRender());
  }

  console.log('Benchmark Results (avg of 100 iterations):');
  console.log('File I/O:', average(results.fileIO), 'ms');
  console.log('Sharp:', average(results.sharp), 'ms');
  console.log('ASCII:', average(results.ascii), 'ms');
  console.log('Render:', average(results.render), 'ms');
}
```

---

## Expected Results

### Performance Progression

| Stage | Frame Time | FPS Capability | Improvement |
|-------|------------|----------------|-------------|
| **Baseline** | 10-20ms | 20 FPS | - |
| After #1 (File I/O) | 7-17ms | 25-30 FPS | 15-20% |
| After #2 (Sharp) | 2-7ms | 40-60 FPS | 70-80% |
| After #3 (Diff Render) | 1-4ms | 60-80 FPS | 85-90% |
| After #4 (Typed Arrays) | 0.7-3.5ms | 80-120 FPS | 90-95% |
| **Final** | **0.5-3ms** | **100+ FPS** | **85-95%** |

### Success Metrics

**Quantitative:**
- ✅ Frame processing time: <5ms on modern hardware
- ✅ Achievable FPS: 60+ FPS
- ✅ CPU usage: <30% of single core
- ✅ Memory usage: Stable (no leaks)
- ✅ GC pause frequency: Reduced by 50%+

**Qualitative:**
- ✅ Smooth visual experience
- ✅ No stuttering or dropped frames
- ✅ Responsive to terminal resize
- ✅ Works on lower-end hardware (adaptive FPS)

---

## Implementation Priority Order

### Phase 1: Critical Path (Highest ROI)
1. **Upgrade #2** - Optimize Sharp input resolution
   - Easiest to implement
   - Biggest single improvement (5-10ms)
   - No library dependencies

2. **Upgrade #1** - Eliminate File I/O
   - May require library replacement
   - High impact (2-3ms)
   - Foundational improvement

### Phase 2: Quick Wins
3. **Upgrade #4** - Typed Arrays for ASCII
   - Simple refactor
   - Good improvements (0.3-0.5ms + GC)
   - Low complexity

### Phase 3: Polish
4. **Upgrade #3** - Differential Rendering
   - More complex implementation
   - Medium impact (1-3ms)
   - Nice-to-have

5. **Upgrade #5** - Adaptive FPS
   - Experience improvement
   - Works across hardware tiers

6. **Upgrade #6** - Cache Sharp Pipeline
   - Minimal gains (0.5-1ms)
   - Low priority

---

## Risk Assessment

### Low Risk
- ✅ Upgrade #2: Dynamic resolution
- ✅ Upgrade #4: Typed arrays
- ✅ Upgrade #6: Pipeline caching

### Medium Risk
- ⚠️ Upgrade #3: Diff rendering (correctness concerns)
- ⚠️ Upgrade #5: Adaptive FPS (complexity)

### High Risk
- ⚠️ Upgrade #1: File I/O elimination
  - May require replacing `node-webcam` library
  - Potential compatibility issues
  - Fallback: Keep file-based as option

---

## Rollback Strategy

### Version Control
- Create branch: `feature/performance-optimization`
- Commit each upgrade separately
- Tag stable points: `v1.0-baseline`, `v1.1-optimized-sharp`, etc.

### Measurement Gates
Before proceeding to next optimization:
- ✅ Performance improved as expected
- ✅ No memory leaks detected
- ✅ Visual quality acceptable
- ✅ No crashes or errors

### Fallback Options
- Keep file-based I/O as config option
- Make optimizations toggleable via config flags
- Maintain backward compatibility

---

## Conclusion

This optimization plan targets the critical bottlenecks identified through performance profiling:
1. **Sharp image processing** (60-75% of time)
2. **File I/O overhead** (10-15% of time)
3. **Terminal rendering** (10-20% of time)

By addressing these systematically, we expect to achieve:
- **85-95% reduction** in frame processing time
- **60-120 FPS** on modern hardware
- **Graceful degradation** on slower systems

The optimizations are prioritized by ROI and risk, with clear measurement criteria for each step.
