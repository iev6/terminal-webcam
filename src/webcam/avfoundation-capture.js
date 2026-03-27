import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DYLIB_PATH = join(__dirname, '../native/libAVCapture.dylib');

let frameBuffer = null;
let ffi = null;

async function loadFFI() {
  if (ffi) return ffi;
  try {
    const bunFfi = await import('bun:ffi');
    const { dlopen, FFIType } = bunFfi;

    if (!existsSync(DYLIB_PATH)) return null;

    ffi = dlopen(DYLIB_PATH, {
      av_capture_init: {
        args: [FFIType.i32, FFIType.i32],
        returns: FFIType.i32,
      },
      av_capture_get_frame: {
        args: [FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      av_capture_update_resolution: {
        args: [FFIType.i32, FFIType.i32],
        returns: FFIType.void,
      },
      av_capture_stop: {
        args: [],
        returns: FFIType.void,
      },
    });
    return ffi;
  } catch (e) {
    return null;
  }
}

class AVFoundationCapture {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.isRunning = false;
    this.currentBuffer = null;
    this.framesReceived = 0;
    this._pollTimer = null;
    this._lib = null;
    this._ptrFn = null;
  }

  /**
   * Initialize AVFoundation capture
   * @param {number} width
   * @param {number} height
   * @returns {Promise<boolean>} true if initialized successfully
   */
  async initialize(width, height) {
    if (os.platform() !== 'darwin') return false;
    if (!existsSync(DYLIB_PATH)) return false;

    try {
      const loaded = await loadFFI();
      if (!loaded) return false;
      this._lib = loaded;

      // Get ptr function
      const bunFfi = await import('bun:ffi');
      this._ptrFn = bunFfi.ptr;

      this.width = width;
      this.height = height;
      frameBuffer = Buffer.allocUnsafe(width * height);

      const ok = this._lib.symbols.av_capture_init(width, height);
      if (!ok) return false;

      this.isRunning = true;
      this._startPolling();
      return true;
    } catch (e) {
      return false;
    }
  }

  _startPolling() {
    const poll = () => {
      if (!this.isRunning || !this._lib || !frameBuffer) return;

      try {
        const bytes = this._lib.symbols.av_capture_get_frame(
          this._ptrFn(frameBuffer),
          frameBuffer.length
        );

        if (bytes > 0) {
          // Create a copy so consumer has stable data until next poll
          if (!this.currentBuffer || this.currentBuffer.length !== bytes) {
            this.currentBuffer = Buffer.allocUnsafe(bytes);
          }
          frameBuffer.copy(this.currentBuffer, 0, 0, bytes);
          this.framesReceived++;
        }
      } catch (e) {
        // Swallow FFI errors
      }

      this._pollTimer = setTimeout(poll, 16); // ~60fps poll
    };

    poll();
  }

  getLatestFrame() {
    return this.currentBuffer;
  }

  updateResolution(width, height) {
    if (width === this.width && height === this.height) return;

    this.width = width;
    this.height = height;
    frameBuffer = Buffer.allocUnsafe(width * height);

    if (this._lib) {
      this._lib.symbols.av_capture_update_resolution(width, height);
    }

    this.currentBuffer = null;
  }

  async cleanup() {
    this.isRunning = false;

    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }

    if (this._lib) {
      try {
        this._lib.symbols.av_capture_stop();
      } catch (e) {}
    }

    this.currentBuffer = null;
    frameBuffer = null;
  }

  isCapturing() {
    return this.isRunning;
  }

  getStats() {
    return {
      platform: 'darwin',
      mode: 'avfoundation',
      width: this.width,
      height: this.height,
      isRunning: this.isRunning,
      hasFrame: !!this.currentBuffer,
      framesReceived: this.framesReceived,
    };
  }
}

export default AVFoundationCapture;
