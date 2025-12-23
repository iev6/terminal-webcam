import NodeWebcam from 'node-webcam';
import { promises as fs } from 'fs';
import config from './config.js';

class WebcamCapture {
  constructor() {
    this.webcam = null;
    this.isInitialized = false;
    this.captureInProgress = false;
    this.continuousMode = false;
    this.captureLoopRunning = false;
    this.lastFramePath = null;
    this.lastFrameBuffer = null;  // NEW: Store buffer in memory
    this.lastFrameTimestamp = 0;
    this.config = { ...config };  // Make a mutable copy
  }

  /**
   * Initialize the webcam
   * @param {number} width - Optional capture width
   * @param {number} height - Optional capture height
   */
  initialize(width = null, height = null) {
    if (this.isInitialized) return;

    // Use provided dimensions or defaults from config
    if (width && height) {
      this.config.width = width;
      this.config.height = height;
    }

    const opts = {
      width: this.config.width,
      height: this.config.height,
      quality: this.config.quality,
      output: this.config.output,
      device: this.config.device,
      callbackReturn: 'location',
      verbose: false
    };

    this.webcam = NodeWebcam.create(opts);
    this.isInitialized = true;

    console.log(`[Webcam] Initialized at ${this.config.width}x${this.config.height}`);
  }

  /**
   * Update capture resolution (requires reinitialization)
   * @param {number} width - New capture width
   * @param {number} height - New capture height
   */
  updateResolution(width, height) {
    if (width === this.config.width && height === this.config.height) {
      return; // No change needed
    }

    this.config.width = width;
    this.config.height = height;

    // Reinitialize webcam with new dimensions
    this.isInitialized = false;
    this.initialize();
  }

  /**
   * Start continuous capture mode - keeps camera on
   */
  startContinuousCapture() {
    if (this.captureLoopRunning) return;

    this.continuousMode = true;
    this.captureLoopRunning = true;
    this._runCaptureLoop();
  }

  /**
   * Stop continuous capture mode
   */
  stopContinuousCapture() {
    this.continuousMode = false;
    this.captureLoopRunning = false;
  }

  /**
   * Internal continuous capture loop
   * @private
   */
  async _runCaptureLoop() {
    while (this.continuousMode) {
      if (!this.captureInProgress) {
        this.captureInProgress = true;

        try {
          // Capture image to temp file
          await new Promise((resolve, reject) => {
            this.webcam.capture(this.config.tmpFile, (err, data) => {
              if (err) reject(err);
              else resolve(data);
            });
          });

          // OPTIMIZATION #1: Read file into memory immediately
          // This eliminates Sharp's file read overhead on every render
          this.lastFrameBuffer = await fs.readFile(this.config.tmpFile);
          this.lastFramePath = this.config.tmpFile;
          this.lastFrameTimestamp = Date.now();

        } catch (error) {
          console.error('Continuous capture error:', error.message);
        } finally {
          this.captureInProgress = false;
        }
      }

      // Small delay to prevent CPU thrashing (capture as fast as possible but yield to event loop)
      await new Promise(resolve => setImmediate(resolve));
    }

    this.captureLoopRunning = false;
  }

  /**
   * Get the latest captured frame as a buffer (for continuous mode)
   * OPTIMIZATION: Returns buffer instead of file path to eliminate Sharp file I/O
   * @returns {Buffer|null} Buffer containing latest captured image
   */
  getLatestFrame() {
    return this.lastFrameBuffer;
  }

  /**
   * Get the latest frame file path (legacy, for snapshots)
   * @returns {string|null} File path to latest captured image
   */
  getLatestFramePath() {
    return this.lastFramePath;
  }

  /**
   * Capture a single frame from the webcam (legacy mode)
   * @returns {Promise<Buffer>} Buffer containing captured image
   */
  async captureFrame() {
    if (!this.isInitialized) {
      throw new Error('Webcam not initialized. Call initialize() first.');
    }

    // In continuous mode, just return the latest frame
    if (this.continuousMode) {
      return this.getLatestFrame();
    }

    // Legacy single-shot mode
    if (this.captureInProgress) {
      return null; // Skip frame if previous capture still in progress
    }

    this.captureInProgress = true;

    try {
      // Capture image to temp file
      await new Promise((resolve, reject) => {
        this.webcam.capture(this.config.tmpFile, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      // Read into memory and return buffer
      return await fs.readFile(this.config.tmpFile);
    } catch (error) {
      console.error('Frame capture error:', error.message);
      return null;
    } finally {
      this.captureInProgress = false;
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Stop continuous capture if running
    this.stopContinuousCapture();

    // Wait a bit for capture loop to finish
    if (this.captureLoopRunning) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    try {
      // Remove temp file if it exists
      await fs.unlink(this.config.tmpFile).catch(() => {});
    } catch (error) {
      // Ignore cleanup errors
    }

    // Clear buffer from memory
    this.lastFrameBuffer = null;
  }
}

export default WebcamCapture;
