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
    this.colorMode = false;
  }

  /**
   * Update the character ramp used for ASCII conversion
   * @param {string} charRamp - String of characters from darkest to brightest
   */
  setCharacterRamp(charRamp) {
    this.charRamp = charRamp;
  }

  /**
   * Enable or disable color mode (ANSI truecolor output)
   * @param {boolean} enabled
   */
  setColorMode(enabled) {
    this.colorMode = enabled;
  }

  /**
   * Convert image buffer to terminal-displayable ASCII format
   * Supports raw grayscale pixels, raw RGB24 pixels, and JPEG buffers
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

      const expectedGray = width * height;       // 1 byte/pixel
      const expectedRgb  = width * height * 3;   // 3 bytes/pixel

      if (imageSource.length === expectedRgb && this.mode !== 'sharp') {
        // RGB24 raw path (color mode AVFoundation / FFmpeg)
        return this._rgbPixelsToAscii(imageSource, width, height);
      } else if (imageSource.length === expectedGray && this.mode !== 'sharp') {
        // HARDWARE ACCELERATED PATH: raw grayscale pixels, already scaled
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
    let pipeline = sharp(imageSource, {
      sequentialRead: true,
      limitInputPixels: false
    })
      .resize({
        width: Math.floor(width),
        height: Math.floor(height),
        fit: 'contain',
        kernel: 'nearest',  // Fastest kernel
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      });

    if (this.colorMode) {
      const { data, info } = await pipeline
        .toFormat('raw')
        .toBuffer({ resolveWithObject: true });
      return this._rgbPixelsToAscii(data, info.width, info.height);
    } else {
      const { data, info } = await pipeline
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return this._pixelsToAscii(data, info.width, info.height);
    }
  }

  /**
   * Convert RGB24 pixel data to ANSI truecolor ASCII art
   * Uses run-length optimization: only emits a new escape code when color changes.
   * @private
   * @param {Buffer} pixelData - Raw RGB24 pixel data (3 bytes per pixel)
   * @param {number} width - Image width
   * @param {number} height - Image height
   * @returns {string} ANSI colored ASCII representation
   */
  _rgbPixelsToAscii(pixelData, width, height) {
    const lines = [];
    const rampLength = this.charRamp.length;

    for (let y = 0; y < height; y++) {
      let line = '';
      let prevR = -1, prevG = -1, prevB = -1;
      const rowStart = y * width * 3;

      for (let x = 0; x < width; x++) {
        const i = rowStart + x * 3;
        const r = pixelData[i];
        const g = pixelData[i + 1];
        const b = pixelData[i + 2];

        // Luma for character selection
        const luma = (r * 77 + g * 150 + b * 29) >> 8;  // integer approximation of 0.299/0.587/0.114
        const index = Math.floor((luma / 255) * (rampLength - 1));

        // Only emit new ANSI code when color actually changes (run-length optimization)
        if (r !== prevR || g !== prevG || b !== prevB) {
          line += `\x1b[38;2;${r};${g};${b}m`;
          prevR = r; prevG = g; prevB = b;
        }

        line += this.charRamp[index];
      }

      line += '\x1b[0m';  // Reset at end of each line
      lines.push(line);
    }

    return lines.join('\n');
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
