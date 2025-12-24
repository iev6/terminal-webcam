import chalk from 'chalk';

class Controls {
  constructor(screen) {
    this.screen = screen;
    this.helpVisible = false;
    this.onQuitCallback = null;
    this.onSnapshotCallback = null;
    this.onToggleLogsCallback = null;
    this.onNextCharsetCallback = null;
    this.onPrevCharsetCallback = null;
  }

  /**
   * Setup keyboard controls
   */
  setup(onQuit, onSnapshot, onToggleLogs, onNextCharset, onPrevCharset) {
    this.onQuitCallback = onQuit;
    this.onSnapshotCallback = onSnapshot;
    this.onToggleLogsCallback = onToggleLogs;
    this.onNextCharsetCallback = onNextCharset;
    this.onPrevCharsetCallback = onPrevCharset;

    // Quit on 'q', 'ESC', or Ctrl+C
    this.screen.key(['q', 'Q', 'escape', 'C-c'], () => {
      if (this.onQuitCallback) {
        this.onQuitCallback();
      }
    });

    // Toggle help on 'h' or '?'
    this.screen.key(['h', 'H', '?'], () => {
      this.toggleHelp();
    });

    // Take snapshot on 's' or 'S'
    this.screen.key(['s', 'S'], () => {
      if (this.onSnapshotCallback) {
        this.onSnapshotCallback();
      }
    });

    // Toggle performance logs on 'l' or 'L'
    this.screen.key(['l', 'L'], () => {
      if (this.onToggleLogsCallback) {
        this.onToggleLogsCallback();
      }
    });

    // Cycle to next character set with right arrow or '.'
    this.screen.key(['right', '.', '>'], () => {
      if (this.onNextCharsetCallback) {
        this.onNextCharsetCallback();
      }
    });

    // Cycle to previous character set with left arrow or ','
    this.screen.key(['left', ',', '<'], () => {
      if (this.onPrevCharsetCallback) {
        this.onPrevCharsetCallback();
      }
    });
  }

  /**
   * Toggle help overlay
   */
  toggleHelp() {
    this.helpVisible = !this.helpVisible;
    // Help overlay rendering is handled by screen.js
    this.screen.emit('help-toggle', this.helpVisible);
  }

  /**
   * Get help text
   */
  getHelpText() {
    return [
      chalk.bold.cyan('Keyboard Controls:'),
      '',
      chalk.white('q, ESC     ') + chalk.gray('- Quit application'),
      chalk.white('h, ?       ') + chalk.gray('- Toggle this help'),
      chalk.white('s          ') + chalk.gray('- Save snapshot'),
      chalk.white('l          ') + chalk.gray('- Toggle performance logs'),
      chalk.white('→, .       ') + chalk.gray('- Next character set'),
      chalk.white('←, ,       ') + chalk.gray('- Previous character set'),
      '',
      chalk.dim('Press h or ? to close this help')
    ].join('\n');
  }

  /**
   * Check if help is visible
   */
  isHelpVisible() {
    return this.helpVisible;
  }
}

export default Controls;
