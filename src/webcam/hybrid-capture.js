import FFmpegCapture from './ffmpeg-capture.js';
import WebcamCapture from './capture.js';

/**
 * Hybrid capture manager
 * Tries FFmpeg hardware acceleration first, falls back to software rendering
 */
class HybridCapture {
  constructor() {
    this.ffmpegCapture = null;
    this.softwareCapture = null;
    this.activeCapture = null;
    this.mode = null;  // 'hardware' or 'software'
    this.width = 600;
    this.height = 150;
  }

  /**
   * Initialize capture with the best available method
   * @param {number} width - Capture width
   * @param {number} height - Capture height
   * @returns {Promise<string>} Mode used ('hardware' or 'software')
   */
  async initialize(width, height) {
    this.width = width;
    this.height = height;

    // Silent initialization - mode details available with 'l' key
    this.ffmpegCapture = new FFmpegCapture();
    const ffmpegAvailable = await this.ffmpegCapture.initialize(width, height);

    if (ffmpegAvailable) {
      this.activeCapture = this.ffmpegCapture;
      this.mode = 'hardware';
      this.ffmpegCapture.start();
      return 'hardware';
    }

    // Fallback to software rendering (silent)

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
   * @returns {string} 'hardware' or 'software'
   */
  getMode() {
    return this.mode;
  }

  /**
   * Check if using hardware acceleration
   * @returns {boolean}
   */
  isHardwareAccelerated() {
    return this.mode === 'hardware';
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
   * For hardware mode, we need to capture a separate snapshot
   */
  async saveSnapshot() {
    if (this.mode === 'software' && this.softwareCapture) {
      // Return the temp file path for copying
      return this.softwareCapture.getLatestFramePath();
    } else if (this.mode === 'hardware') {
      // For hardware mode, snapshots not yet supported
      return null;
    }
    return null;
  }
}

export default HybridCapture;
