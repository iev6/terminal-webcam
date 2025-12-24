import ImageConverter from './converter.js';

class TerminalRenderer {
  constructor(webcamCapture, config) {
    this.webcam = webcamCapture;
    this.config = config;
    this.converter = new ImageConverter();
    this.isRunning = false;
    this.timeoutId = null;
    this.frameCount = 0;
    this.lastFpsUpdate = Date.now();
    this.currentFps = 0;
    this.onFrameCallback = null;
    this.onStatsCallback = null;

    // Performance monitoring
    this.performanceStats = {
      captureTime: 0,
      sharpTime: 0,
      totalTime: 0,
      sampleCount: 0
    };
    this.enablePerfLogging = false;  // Hidden by default, toggle with 'l' key
  }

  /**
   * Start the rendering loop
   * @param {Function} onFrame - Callback function(frameString) called with each rendered frame
   * @param {Function} onStats - Callback function(stats) called with performance stats
   */
  start(onFrame, onStats) {
    if (this.isRunning) return;

    this.onFrameCallback = onFrame;
    this.onStatsCallback = onStats;
    this.isRunning = true;
    this.frameCount = 0;
    this.lastFpsUpdate = Date.now();

    // Start capture loop with recursive setTimeout to properly handle async operations
    this._scheduleNextFrame();
  }

  /**
   * Stop the rendering loop
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Schedule the next frame capture
   * @private
   */
  _scheduleNextFrame() {
    if (!this.isRunning) return;

    this.timeoutId = setTimeout(() => {
      this._captureAndRender();
    }, this.config.delay);
  }

  /**
   * Internal method to capture and render a frame
   * @private
   */
  async _captureAndRender() {
    if (!this.isRunning) return;

    // Schedule next frame immediately to ensure continuous loop
    // This allows frames to be 1-2 behind for smoother playback
    this._scheduleNextFrame();

    const frameStart = performance.now();

    try {
      // OPTIMIZATION #1 & #3: Get latest frame from capture system
      // Frame is already being captured continuously in the background
      const captureStart = performance.now();
      const frameBuffer = this.webcam.getLatestFrame();  // Synchronous - just gets cached frame
      const captureTime = performance.now() - captureStart;

      if (!frameBuffer) {
        // Frame not ready yet (first few frames), next frame already scheduled
        return;
      }

      // Get terminal dimensions (will be provided by UI)
      const dimensions = this._getTerminalDimensions();

      // Convert to terminal format (sharp processes buffer directly)
      const sharpStart = performance.now();
      const terminalFrame = await this.converter.convertToTerminal(
        frameBuffer,
        dimensions.width,
        dimensions.height
      );
      const sharpTime = performance.now() - sharpStart;

      // Send frame to display callback
      if (this.onFrameCallback) {
        this.onFrameCallback(terminalFrame);
      }

      const totalTime = performance.now() - frameStart;

      // Track performance stats
      this._trackPerformance(captureTime, sharpTime, totalTime);

      // Update FPS counter
      this._updateFps();

    } catch (error) {
      console.error('Render loop error:', error);
      // Next frame already scheduled, loop continues
    }
  }

  /**
   * Track performance statistics
   * @private
   */
  _trackPerformance(captureTime, sharpTime, totalTime) {
    this.performanceStats.captureTime += captureTime;
    this.performanceStats.sharpTime += sharpTime;
    this.performanceStats.totalTime += totalTime;
    this.performanceStats.sampleCount++;

    // Log every 100 frames
    if (this.enablePerfLogging && this.performanceStats.sampleCount % 100 === 0) {
      const samples = this.performanceStats.sampleCount;
      const mode = this.webcam.getMode?.() || 'unknown';
      const isHW = mode === 'hardware';

      console.log(`\n[Performance Stats - Avg over 100 frames] Mode: ${mode.toUpperCase()}`);
      console.log(`  Capture: ${(this.performanceStats.captureTime / samples).toFixed(2)}ms`);
      console.log(`  ${isHW ? 'Convert' : 'Sharp'}:  ${(this.performanceStats.sharpTime / samples).toFixed(2)}ms ${isHW ? '← GPU accelerated!' : ''}`);
      console.log(`  Total:   ${(this.performanceStats.totalTime / samples).toFixed(2)}ms`);
      console.log(`  FPS:     ${this.currentFps}`);

      if (isHW) {
        console.log(`  💡 Hardware acceleration active - GPU doing the heavy lifting!`);
      }

      // Reset for next sample period
      this.performanceStats = {
        captureTime: 0,
        sharpTime: 0,
        totalTime: 0,
        sampleCount: 0
      };
    }
  }

  /**
   * Update FPS statistics
   * @private
   */
  _updateFps() {
    this.frameCount++;

    const now = Date.now();
    const elapsed = now - this.lastFpsUpdate;

    // Update FPS every second
    if (elapsed >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / elapsed);

      if (this.onStatsCallback) {
        this.onStatsCallback({
          fps: this.currentFps,
          targetFps: this.config.targetFPS,
          frameCount: this.frameCount,
          dimensions: this.converter.getDimensions()
        });
      }

      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  /**
   * Get terminal dimensions (to be overridden by UI)
   * @private
   */
  _getTerminalDimensions() {
    return {
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24
    };
  }

  /**
   * Set custom dimension provider
   * @param {Function} dimensionFn - Function that returns {width, height}
   */
  setDimensionProvider(dimensionFn) {
    this._getTerminalDimensions = dimensionFn;
  }

  /**
   * Get current FPS
   */
  getFps() {
    return this.currentFps;
  }

  /**
   * Toggle performance logging
   * @returns {boolean} New state
   */
  togglePerfLogging() {
    this.enablePerfLogging = !this.enablePerfLogging;
    return this.enablePerfLogging;
  }

  /**
   * Get performance logging state
   * @returns {boolean}
   */
  isPerfLoggingEnabled() {
    return this.enablePerfLogging;
  }

  /**
   * Set character set for ASCII rendering
   * @param {string} charRamp - String of characters from darkest to brightest
   */
  setCharacterSet(charRamp) {
    this.converter.setCharacterRamp(charRamp);
  }
}

export default TerminalRenderer;
