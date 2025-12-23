import { spawn } from 'child_process';
import os from 'os';

/**
 * Hardware-accelerated webcam capture using FFmpeg
 * Uses GPU for decoding, scaling, and color conversion
 * Outputs raw grayscale pixel data directly to memory
 */
class FFmpegCapture {
  constructor() {
    this.ffmpeg = null;
    this.isRunning = false;
    this.width = 600;
    this.height = 150;
    this.bytesPerFrame = 0;
    this.currentBuffer = null;
    this.frameTimestamp = 0;
    this.incompleteBuffer = Buffer.alloc(0);
    this.platform = os.platform();
    this.framesReceived = 0;
    this.lastLogTime = Date.now();
  }

  /**
   * Detect platform and get appropriate FFmpeg arguments
   * @param {number} width - Capture width
   * @param {number} height - Capture height
   * @returns {Array} FFmpeg arguments
   */
  _getFFmpegArgs(width, height) {
    const platform = this.platform;

    // Common output settings
    const outputArgs = [
      '-vf', `scale=${width}:${height}`,
      '-pix_fmt', 'gray',
      '-f', 'rawvideo',
      '-'
    ];

    if (platform === 'darwin') {
      // macOS - AVFoundation with VideoToolbox hardware acceleration
      // IMPORTANT: -hwaccel MUST come BEFORE -i (input option)
      return [
        '-hwaccel', 'videotoolbox',  // Hardware accel BEFORE input
        '-f', 'avfoundation',
        '-framerate', '30',
        '-video_size', '1280x720',
        '-i', '0',  // Default camera
        ...outputArgs
      ];
    } else if (platform === 'linux') {
      // Linux - V4L2 with VAAPI hardware acceleration
      return [
        '-hwaccel', 'vaapi',
        '-hwaccel_device', '/dev/dri/renderD128',
        '-f', 'v4l2',
        '-framerate', '30',
        '-video_size', '1280x720',
        '-i', '/dev/video0',
        ...outputArgs
      ];
    } else if (platform === 'win32') {
      // Windows - DirectShow with DXVA2 hardware acceleration
      return [
        '-hwaccel', 'dxva2',
        '-f', 'dshow',
        '-framerate', '30',
        '-video_size', '1280x720',
        '-i', 'video="Integrated Camera"',  // May need adjustment
        ...outputArgs
      ];
    } else {
      // Fallback - no hardware acceleration
      return [
        '-f', 'v4l2',
        '-framerate', '30',
        '-video_size', '1280x720',
        '-i', '/dev/video0',
        ...outputArgs
      ];
    }
  }

  /**
   * Check if FFmpeg is available
   * @returns {Promise<boolean>}
   */
  async checkFFmpegAvailable() {
    return new Promise((resolve) => {
      const check = spawn('ffmpeg', ['-version']);

      check.on('error', () => {
        resolve(false);
      });

      check.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }

  /**
   * Initialize and start FFmpeg capture
   * @param {number} width - Output width
   * @param {number} height - Output height
   * @returns {Promise<boolean>} Success
   */
  async initialize(width, height) {
    this.width = width;
    this.height = height;
    this.bytesPerFrame = width * height;  // 1 byte per pixel (grayscale)

    // Silent initialization - logs available with 'l' key

    // Check if FFmpeg is available (silent check)
    const available = await this.checkFFmpegAvailable();
    return available;
  }

  /**
   * Start the FFmpeg capture process
   */
  start() {
    if (this.isRunning) {
      return;
    }

    const args = this._getFFmpegArgs(this.width, this.height);

    this.ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.isRunning = true;

    // Handle stdout - raw grayscale pixel data
    this.ffmpeg.stdout.on('data', (chunk) => {
      this._handleFrameData(chunk);
    });

    // Handle stderr - FFmpeg logs (suppressed, toggle with 'l' key)
    this.ffmpeg.stderr.on('data', (data) => {
      // Suppress all FFmpeg stderr output by default
      // This includes codec info, stream details, warnings
    });

    this.ffmpeg.on('error', (err) => {
      // Silent error handling
      this.isRunning = false;
    });

    this.ffmpeg.on('close', (code) => {
      this.isRunning = false;
    });
  }

  /**
   * Handle incoming frame data from FFmpeg stdout
   * @param {Buffer} chunk - Raw data chunk
   * @private
   */
  _handleFrameData(chunk) {
    // Concatenate with any incomplete data from previous chunks
    this.incompleteBuffer = Buffer.concat([this.incompleteBuffer, chunk]);

    // Extract complete frames
    while (this.incompleteBuffer.length >= this.bytesPerFrame) {
      // Extract one frame
      this.currentBuffer = this.incompleteBuffer.slice(0, this.bytesPerFrame);
      this.frameTimestamp = Date.now();
      this.framesReceived++;

      // Remove processed frame from buffer
      this.incompleteBuffer = this.incompleteBuffer.slice(this.bytesPerFrame);

      // Track FPS silently
      const now = Date.now();
      if (now - this.lastLogTime > 5000) {
        this.framesReceived = 0;
        this.lastLogTime = now;
      }
    }
  }

  /**
   * Get the latest frame buffer
   * @returns {Buffer|null} Raw grayscale pixel data
   */
  getLatestFrame() {
    return this.currentBuffer;
  }

  /**
   * Get frame timestamp
   * @returns {number} Timestamp in milliseconds
   */
  getFrameTimestamp() {
    return this.frameTimestamp;
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

    // Stop current process
    this.stop();

    // Update dimensions
    this.width = width;
    this.height = height;
    this.bytesPerFrame = width * height;

    // Restart with new dimensions
    this.start();
  }

  /**
   * Stop the FFmpeg process
   */
  stop() {
    if (!this.isRunning) return;

    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM');
      this.ffmpeg = null;
    }

    this.isRunning = false;
    this.currentBuffer = null;
    this.incompleteBuffer = Buffer.alloc(0);
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.stop();
  }

  /**
   * Check if capture is running
   * @returns {boolean}
   */
  isCapturing() {
    return this.isRunning;
  }

  /**
   * Get capture statistics
   * @returns {Object}
   */
  getStats() {
    return {
      platform: this.platform,
      width: this.width,
      height: this.height,
      bytesPerFrame: this.bytesPerFrame,
      isRunning: this.isRunning,
      hasFrame: !!this.currentBuffer
    };
  }
}

export default FFmpegCapture;
