import blessed from 'blessed';
import chalk from 'chalk';
import { getVideoBoxDimensions } from '../utils/terminal-size.js';

// Suppress blessed debug output
process.env.BLESSED_DEBUG = '0';

class Screen {
  constructor() {
    this.screen = null;
    this.videoBox = null;
    this.statusBar = null;
    this.helpBox = null;
    this.stats = {
      fps: 0,
      targetFps: 0,
      frameCount: 0,
      dimensions: { width: 0, height: 0 },
      charsetName: 'Blocks'
    };
    // Performance optimization: batch renders
    this.renderScheduled = false;
    this.pendingUpdates = {
      video: false,
      stats: false
    };
  }

  /**
   * Initialize the blessed screen and components
   */
  initialize() {
    // Temporarily suppress console output during blessed initialization
    // to prevent terminfo compiler debug output
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};

    try {
      // Create screen
      this.screen = blessed.screen({
        smartCSR: true,
        fullUnicode: true,
        dockBorders: true,
        title: 'Terminal Webcam',
        // Disable debug output
        debug: false,
        dump: false,
        warnings: false,
        // Force standard terminal mode to avoid capability compilation
        terminal: 'xterm-256color',
        forceUnicode: true
      });
    } finally {
      // Restore console methods
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    }

    // Create video display box using text widget for ASCII content
    this.videoBox = blessed.text({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-2',
      content: 'Initializing webcam...',
      tags: false,
      scrollable: false,
      alwaysScroll: false,
      border: {
        type: 'line',
        fg: 'cyan'
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'cyan'
        }
      }
    });

    // Create status bar
    this.statusBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      content: this._getStatusText(),
      tags: true,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    // Create help overlay (hidden by default)
    this.helpBox = blessed.box({
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      content: '',
      tags: true,
      hidden: true,
      border: {
        type: 'line',
        fg: 'yellow'
      },
      style: {
        fg: 'white',
        bg: 'black',
        border: {
          fg: 'yellow'
        }
      }
    });

    // Add components to screen
    this.screen.append(this.videoBox);
    this.screen.append(this.statusBar);
    this.screen.append(this.helpBox);

    // Handle resize events
    this.screen.on('resize', () => {
      this.render();
    });

    // Initial render
    this.render();
  }

  /**
   * Update video content with ASCII frame
   */
  updateVideo(content) {
    if (this.videoBox) {
      // Set the ASCII content directly
      this.videoBox.setContent(content);
      this.pendingUpdates.video = true;
      this._scheduleRender();
    }
  }

  /**
   * Update stats
   */
  updateStats(stats) {
    this.stats = { ...this.stats, ...stats };
    this.statusBar.setContent(this._getStatusText());
    this.pendingUpdates.stats = true;
    this._scheduleRender();
  }

  /**
   * Schedule a batched render (performance optimization)
   * @private
   */
  _scheduleRender() {
    if (this.renderScheduled) return;

    this.renderScheduled = true;
    // Use setImmediate for batching updates in the same tick
    setImmediate(() => {
      this._performRender();
    });
  }

  /**
   * Perform the actual render
   * @private
   */
  _performRender() {
    if (this.screen) {
      this.screen.render();
    }
    this.renderScheduled = false;
    this.pendingUpdates.video = false;
    this.pendingUpdates.stats = false;
  }

  /**
   * Show/hide help overlay
   */
  toggleHelp(helpText) {
    if (this.helpBox.hidden) {
      this.helpBox.setContent('\n  ' + helpText.replace(/\n/g, '\n  '));
      this.helpBox.show();
    } else {
      this.helpBox.hide();
    }
    this.render();
  }

  /**
   * Show notification message
   */
  showNotification(message, duration = 2000) {
    const notification = blessed.box({
      top: 'center',
      left: 'center',
      width: 'shrink',
      height: 'shrink',
      content: `  ${message}  `,
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        fg: 'white',
        bg: 'green',
        border: {
          fg: 'green'
        }
      }
    });

    this.screen.append(notification);
    this.render();

    setTimeout(() => {
      this.screen.remove(notification);
      this.render();
    }, duration);
  }

  /**
   * Get status bar text
   * @private
   */
  _getStatusText() {
    const { fps, targetFps, dimensions, charsetName } = this.stats;

    const fpsText = fps > 0 ? `${fps}/${targetFps} FPS` : 'Starting...';
    const dimText = dimensions.width > 0
      ? `${dimensions.width}x${dimensions.height}`
      : '--';

    return chalk.bold.white(` Terminal Webcam `) +
           chalk.gray('|') +
           chalk.cyan(` ${fpsText} `) +
           chalk.gray('|') +
           chalk.yellow(` ${dimText} `) +
           chalk.gray('|') +
           chalk.magenta(` ${charsetName || 'Blocks'} `) +
           chalk.gray('|') +
           chalk.green(' Press h for help ');
  }

  /**
   * Get video box dimensions for rendering
   */
  getVideoDimensions() {
    return getVideoBoxDimensions();
  }

  /**
   * Render the screen
   */
  render() {
    if (this.screen) {
      this.screen.render();
    }
  }

  /**
   * Get the underlying blessed screen object
   */
  getScreen() {
    return this.screen;
  }

  /**
   * Destroy the screen
   */
  destroy() {
    if (this.screen) {
      this.screen.destroy();
    }
  }
}

export default Screen;
