import sharp from 'sharp';

// Enable Sharp SIMD optimizations for better performance
sharp.simd(true);
sharp.concurrency(1);  // Single-threaded is faster for small images

class ImageConverter {
  constructor(charRamp = ' ░▒▓█') {
    this.lastWidth = 0;
    this.lastHeight = 0;
    // Grayscale character ramp from darkest to brightest
    // Can be changed dynamically with setCharacterRamp()
    this.charRamp = charRamp;
    this.mode = 'auto';  // 'auto', 'raw', 'sharp'
  }

  /**
   * Update the character ramp used for ASCII conversion
   * @param {string} charRamp - String of characters from darkest to brightest
   */
  setCharacterRamp(charRamp) {
    this.charRamp = charRamp;
  }

  /**
   * Convert image buffer to terminal-displayable ASCII format
   * Supports both raw grayscale pixels (from FFmpeg) and JPEG buffers (from node-webcam)
   * @param {Buffer} imageSource - Raw pixel buffer or JPEG buffer
   * @param {number} width - Terminal width in characters
   * @param {number} height - Terminal height in characters
   * @param {Object} options - Conversion options
   * @returns {Promise<string>} ASCII string ready for terminal display
   */
  async convertToTerminal(imageSource, width, height, options = {}) {
    if (!imageSource) {
      return '';
    }

    try {
      // Cache dimensions for performance tracking
      this.lastWidth = width;
      this.lastHeight = height;

      // Detect if this is raw pixel data or needs Sharp processing
      const expectedRawBytes = width * height;  // 1 byte per pixel for grayscale
      const isRawPixels = imageSource.length === expectedRawBytes;

      if (isRawPixels && this.mode !== 'sharp') {
        // HARDWARE ACCELERATED PATH: FFmpeg already gave us raw grayscale pixels
        // No processing needed - pixels are already scaled and grayscale!
        return this._pixelsToAscii(imageSource, width, height);
      } else {
        // SOFTWARE PATH: Use Sharp to process JPEG buffer
        return await this._convertWithSharp(imageSource, width, height);
      }
    } catch (error) {
      console.error('Image conversion error:', error.message);
      return this._createErrorFrame(width, height, error.message);
    }
  }

  /**
   * Convert using Sharp (software rendering)
   * @param {Buffer} imageSource - JPEG buffer
   * @param {number} width - Target width
   * @param {number} height - Target height
   * @returns {Promise<string>} ASCII frame
   * @private
   */
  async _convertWithSharp(imageSource, width, height) {
    const { data, info } = await sharp(imageSource, {
      sequentialRead: true,
      limitInputPixels: false
    })
      .resize({
        width: Math.floor(width),
        height: Math.floor(height),
        fit: 'contain',
        kernel: 'nearest',  // Fastest kernel
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return this._pixelsToAscii(data, info.width, info.height);
  }

  /**
   * Convert pixel data to ASCII characters
   * @private
   * @param {Buffer} pixelData - Raw grayscale pixel data
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {string} ASCII representation
   */
  _pixelsToAscii(pixelData, width, height) {
    // Performance optimization: use array buffer instead of string concatenation
    const lines = [];
    const rampLength = this.charRamp.length;

    for (let y = 0; y < height; y++) {
      const rowChars = [];
      const rowStart = y * width;

      for (let x = 0; x < width; x++) {
        // Get pixel brightness (0-255)
        const brightness = pixelData[rowStart + x];

        // Map brightness to character (inlined for performance)
        const index = Math.floor((brightness / 255) * (rampLength - 1));
        rowChars.push(this.charRamp[index]);
      }

      lines.push(rowChars.join(''));
    }

    return lines.join('\n');
  }

  /**
   * Map brightness value to ASCII character
   * @private
   * @param {number} brightness - Brightness value (0-255)
   * @returns {string} Character representing the brightness
   */
  _brightnessToChar(brightness) {
    // Map 0-255 brightness to character ramp index
    const rampLength = this.charRamp.length;
    const index = Math.floor((brightness / 255) * (rampLength - 1));
    return this.charRamp[index];
  }

  /**
   * Create an error frame when conversion fails
   * @private
   */
  _createErrorFrame(width, height, errorMsg) {
    const errorLine = 'ERROR: ' + errorMsg;
    const padding = Math.floor((width - errorLine.length) / 2);
    const verticalPadding = Math.floor(height / 2);

    let frame = '\n'.repeat(verticalPadding);
    frame += ' '.repeat(Math.max(0, padding)) + errorLine + '\n';
    frame += '\n'.repeat(Math.max(0, height - verticalPadding - 1));

    return frame;
  }

  /**
   * Get last processed dimensions
   */
  getDimensions() {
    return {
      width: this.lastWidth,
      height: this.lastHeight
    };
  }
}

export default ImageConverter;
