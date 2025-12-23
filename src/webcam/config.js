/**
 * Get optimal capture resolution based on terminal dimensions
 * @param {number} terminalWidth - Terminal width in characters
 * @param {number} terminalHeight - Terminal height in characters
 * @returns {Object} Optimal width and height for capture
 */
export function getOptimalCaptureResolution(terminalWidth, terminalHeight) {
  // Multiply terminal size by 6 for quality while keeping processing efficient
  // Terminal: 100x25 → Capture: 600x150 (vs old 1024x576)
  // This reduces pixel count by ~6.5x for similar visual quality
  const multiplier = 6;
  const captureWidth = Math.min(terminalWidth * multiplier, 1024);
  const captureHeight = Math.min(terminalHeight * multiplier, 576);

  // Round to even numbers for encoder compatibility
  return {
    width: Math.floor(captureWidth / 2) * 2,
    height: Math.floor(captureHeight / 2) * 2
  };
}

/**
 * Create webcam configuration
 * @param {number} terminalWidth - Optional terminal width (defaults to standard resolution)
 * @param {number} terminalHeight - Optional terminal height (defaults to standard resolution)
 */
export function createWebcamConfig(terminalWidth = 100, terminalHeight = 25) {
  const { width, height } = getOptimalCaptureResolution(terminalWidth, terminalHeight);

  return {
    // Target frames per second for capture
    // Set to 20 for smooth continuous playback with breathing room
    targetFPS: 20,

    // Webcam resolution (dynamically calculated based on terminal size)
    width,
    height,

    // Image quality (0-100)
    // Reduced from 85 to 75 for faster encoding/decoding
    quality: 75,

    // Output format
    output: 'jpeg',

    // Camera device (null = default camera)
    device: null,

    // Delay between shots (calculated from FPS)
    get delay() {
      return Math.floor(1000 / this.targetFPS);
    },

    // Temporary file location for captures
    tmpFile: '/tmp/webcam-frame.jpg'
  };
}

// Default config for backward compatibility
export default createWebcamConfig();
