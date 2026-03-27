import FFmpegCapture from './ffmpeg-capture.js';
import WebcamCapture from './capture.js';
import AVFoundationCapture from './avfoundation-capture.js';
import os from 'os';

/**
 * Hybrid capture manager
 * Priority order:
 * 1. AVFoundation (macOS native, Bun FFI, fastest)
 * 2. FFmpeg (hardware accelerated, cross-platform)
 * 3. Software (node-webcam + Sharp, fallback)
 */
class HybridCapture {
  constructor() {
    this.avCapture = null;
    this.ffmpegCapture = null;
    this.softwareCapture = null;
    this.activeCapture = null;
    this.mode = null;  // 'avfoundation', 'hardware', or 'software'
    this.width = 600;
    this.height = 150;
  }

  /**
   * Initialize capture with the best available method
   * @param {number} width - Capture width
   * @param {number} height - Capture height
   * @returns {Promise<string>} Mode used ('avfoundation', 'hardware', or 'software')
   */
  async initialize(width, height) {
    this.width = width;
    this.height = height;

    // Try AVFoundation first (macOS + Bun FFI)
    if (os.platform() === 'darwin') {
      this.avCapture = new AVFoundationCapture();
      const avOk = await this.avCapture.initialize(width, height);
      if (avOk) {
        this.activeCapture = this.avCapture;
        this.mode = 'avfoundation';
        return 'avfoundation';
      }
    }

    // Try FFmpeg hardware acceleration
    this.ffmpegCapture = new FFmpegCapture();
    const ffmpegAvailable = await this.ffmpegCapture.initialize(width, height);

    if (ffmpegAvailable) {
      this.activeCapture = this.ffmpegCapture;
      this.mode = 'hardware';
      this.ffmpegCapture.start();
      return 'hardware';
    }

    // Software fallback
    this.softwareCapture = new WebcamCapture();
    this.softwareCapture.initialize(width, height);
    this.softwareCapture.startContinuousCapture();

    this.activeCapture = this.softwareCapture;
    this.mode = 'software';
    return 'software';
  }

  /**
   * Get the latest frame
   * @returns {Buffer|null} Frame buffer
   */
  getLatestFrame() {
    if (!this.activeCapture) return null;
    return this.activeCapture.getLatestFrame();
  }

  /**
   * Get the latest frame path (for snapshots)
   * @returns {string|null} File path
   */
  getLatestFramePath() {
    if (this.mode === 'avfoundation') {
      return null;
    }
    if (this.mode === 'software' && this.softwareCapture) {
      return this.softwareCapture.getLatestFramePath();
    }
    return null;
  }

  /**
   * Update capture resolution
   * @param {number} width - New width
   * @param {number} height - New height
   */
  updateResolution(width, height) {
    if (width === this.width && height === this.height) {
      return;
    }

    this.width = width;
    this.height = height;

    if (this.activeCapture) {
      this.activeCapture.updateResolution(width, height);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.avCapture) {
      await this.avCapture.cleanup();
    }

    if (this.ffmpegCapture) {
      await this.ffmpegCapture.cleanup();
    }

    if (this.softwareCapture) {
      await this.softwareCapture.cleanup();
    }

    this.activeCapture = null;
  }

  /**
   * Get current capture mode
   * @returns {string} 'avfoundation', 'hardware', or 'software'
   */
  getMode() {
    return this.mode;
  }

  /**
   * Check if using hardware acceleration
   * @returns {boolean}
   */
  isHardwareAccelerated() {
    return this.mode === 'avfoundation' || this.mode === 'hardware';
  }

  /**
   * Get capture statistics
   * @returns {Object}
   */
  getStats() {
    return {
      mode: this.mode,
      width: this.width,
      height: this.height,
      hardwareAccelerated: this.isHardwareAccelerated(),
      ...(this.activeCapture?.getStats?.() || {})
    };
  }

  /**
   * Save snapshot (software mode only)
   * For hardware/avfoundation mode, snapshots not yet supported
   */
  async saveSnapshot() {
    if (this.mode === 'software' && this.softwareCapture) {
      return this.softwareCapture.getLatestFramePath();
    } else if (this.mode === 'hardware' || this.mode === 'avfoundation') {
      return null;
    }
    return null;
  }
}

export default HybridCapture;
