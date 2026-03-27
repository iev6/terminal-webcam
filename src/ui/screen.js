import { EventEmitter } from 'events';
import chalk from 'chalk';
import { getVideoBoxDimensions } from '../utils/terminal-size.js';

class CompatScreen extends EventEmitter {
  constructor() {
    super();
    this._keyHandlers = {};
    this._setupInput();
  }

  _setupInput() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => this._handleKey(key));
    process.stdout.on('resize', () => this.emit('resize'));
  }

  key(keys, callback) {
    for (const k of keys) {
      if (!this._keyHandlers[k]) this._keyHandlers[k] = [];
      this._keyHandlers[k].push(callback);
    }
  }

  _handleKey(rawKey) {
    const keyMap = {
      'q': 'q', 'Q': 'Q',
      '\x1b': 'escape',
      '\x03': 'C-c',
      'h': 'h', 'H': 'H',
      '?': '?',
      's': 's', 'S': 'S',
      'l': 'l', 'L': 'L',
      'p': 'p', 'P': 'P',
      '.': '.', '>': '>',
      ',': ',', '<': '<',
      '\x1b[C': 'right',
      '\x1b[D': 'left',
      'c': 'c', 'C': 'C',
    };

    const mapped = keyMap[rawKey];
    if (mapped && this._keyHandlers[mapped]) {
      this._keyHandlers[mapped].forEach(h => h());
    }
  }
}

class Screen {
  constructor() {
    this._compatScreen = null;
    this._notification = null;
    this._notificationTimer = null;
    this._helpVisible = false;
    this._helpText = null;
    this._lastContent = null;
    this._perfOverlayVisible = false;
    this._perfData = null;
    this._perfHistory = [];
    this.stats = {
      fps: 0,
      targetFps: 0,
      frameCount: 0,
      dimensions: { width: 0, height: 0 },
      charsetName: 'Blocks',
      colorMode: false
    };
  }

  initialize() {
    process.stdout.write('\x1b[?1049h');
    process.stdout.write('\x1b[?25l');
    process.stdout.write('\x1b[2J\x1b[H');
    this._compatScreen = new CompatScreen();
  }

  updateVideo(content) {
    if (this._helpVisible) return;
    this._lastContent = content;
    process.stdout.write('\x1b[H');
    process.stdout.write(content);
    this._renderStatusBar();
    if (this._notification) {
      this._renderNotification();
    }
    if (this._perfOverlayVisible && this._perfData) {
      this._renderPerfOverlay();
    }
  }

  updatePerf(timing) {
    this._perfData = timing;
    this._perfHistory.push(timing.totalMs);
    if (this._perfHistory.length > 90) this._perfHistory.shift();
  }

  togglePerfOverlay() {
    this._perfOverlayVisible = !this._perfOverlayVisible;
    return this._perfOverlayVisible;
  }

  updateStats(stats) {
    this.stats = { ...this.stats, ...stats };
    this._renderStatusBar();
  }

  toggleHelp(helpText) {
    this._helpVisible = !this._helpVisible;
    this._helpText = helpText;
    if (this._helpVisible) {
      this._renderHelp();
    }
    // When hiding, next video frame will overwrite
  }

  showNotification(message, duration = 2000) {
    this._notification = message;
    clearTimeout(this._notificationTimer);
    this._renderNotification();
    this._notificationTimer = setTimeout(() => {
      this._notification = null;
    }, duration);
  }

  render() {
    // no-op — everything is immediate
  }

  getScreen() {
    return this._compatScreen;
  }

  getVideoDimensions() {
    return getVideoBoxDimensions();
  }

  _renderPerfOverlay() {
    const p = this._perfData;
    if (!p) return;

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    // Fixed layout: ' '(1) + label(8) + bar(25) + ' '(1) + ms(5) + 'ms'(2) + ' '(1) + pct(3) + '% '(2) = 48 inner chars
    const BAR_W = 25;
    const INNER_W = 48;
    const OVERLAY_W = INNER_W + 2; // includes │ on each side = 50

    if (OVERLAY_W > cols) return;

    // Sit just above the status bar (last 2 rows), 8 rows tall
    const top = rows - 10;
    const left = 1;
    if (top < 1) return;

    const maxMs = Math.max(p.totalMs, 1);
    const activeMs = p.captureMs + p.convertMs + p.renderMs;
    const idleMs = Math.max(0, p.totalMs - activeMs);

    const phases = [
      { label: 'Capture ', ms: p.captureMs, c: '32' },
      { label: 'Convert ', ms: p.convertMs, c: '33' },
      { label: 'Render  ', ms: p.renderMs,  c: '31' },
      { label: 'Idle    ', ms: idleMs,       c: '90' },
    ];

    const makeBar = (ms) => {
      const f = Math.round((ms / maxMs) * BAR_W);
      return '\u2588'.repeat(Math.max(0, f)) + '\u2591'.repeat(Math.max(0, BAR_W - f));
    };

    const W = (s, r) => process.stdout.write(`\x1b[${r};${left}H${s}`);
    const border = '\u2500'.repeat(INNER_W);

    let row = top;
    W(`\x1b[40m\x1b[36m\u250c${border}\u2510\x1b[0m`, row++);

    const fps = this.stats.fps || 0;
    const mode = this.stats.mode || '';
    const hdr = ` FPS:${fps}  ${mode}  ${p.totalMs.toFixed(1)}ms`;
    W(`\x1b[40m\x1b[36m\u2502\x1b[1;37m${hdr.padEnd(INNER_W)}\x1b[0m\x1b[40m\x1b[36m\u2502\x1b[0m`, row++);

    for (const ph of phases) {
      const msStr = ph.ms.toFixed(1).padStart(5);
      const pct = String(Math.round((ph.ms / p.totalMs) * 100)).padStart(3);
      const content = ` ${ph.label}\x1b[${ph.c}m${makeBar(ph.ms)}\x1b[0m ${msStr}ms ${pct}% `;
      W(`\x1b[40m\x1b[36m\u2502\x1b[0m\x1b[40m${content}\x1b[36m\u2502\x1b[0m`, row++);
    }

    // Sparkline — frame time history (last INNER_W-2 samples, with 1-char margins)
    const sparkChars = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
    const hist = this._perfHistory;
    const maxH = Math.max(...hist, 1);
    const sparkLen = INNER_W - 2;
    const spark = hist.slice(-sparkLen)
      .map(v => sparkChars[Math.min(8, Math.floor((v / maxH) * 8))])
      .join('')
      .padEnd(sparkLen);
    W(`\x1b[40m\x1b[36m\u2502\x1b[90m ${spark} \x1b[36m\u2502\x1b[0m`, row++);

    W(`\x1b[40m\x1b[36m\u2514${border}\u2518\x1b[0m`, row);
  }

  destroy() {
    clearTimeout(this._notificationTimer);
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[?1049l');
    process.stdout.write('\x1b[0m');
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch(e) {}
    }
    this._compatScreen?.removeAllListeners?.();
  }

  _renderStatusBar() {
    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    const text = this._getStatusText();
    process.stdout.write(`\x1b[${rows - 1};1H${text}`);
    process.stdout.write(`\x1b[${rows};1H${'─'.repeat(cols)}`);
  }

  _getStatusText() {
    const { fps, targetFps, dimensions, charsetName, colorMode } = this.stats;
    const fpsText = fps > 0 ? `${fps}/${targetFps} FPS` : 'Starting...';
    const dimText = dimensions.width > 0 ? `${dimensions.width}x${dimensions.height}` : '--';
    const colorText = colorMode ? 'Color' : 'Gray';
    return chalk.bold.white(` Terminal Webcam `) +
           chalk.gray('|') + chalk.cyan(` ${fpsText} `) +
           chalk.gray('|') + chalk.yellow(` ${dimText} `) +
           chalk.gray('|') + chalk.magenta(` ${charsetName || 'Blocks'} `) +
           chalk.gray('|') + chalk.green(` ${colorText} `) +
           chalk.gray('|') + chalk.green(' Press h for help ');
  }

  _renderNotification() {
    if (!this._notification) return;
    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    const msg = `  ${this._notification}  `;
    const col = Math.max(1, Math.floor((cols - msg.length) / 2));
    const row = Math.floor(rows / 2);
    process.stdout.write(`\x1b[${row};${col}H\x1b[42m\x1b[30m${msg}\x1b[0m`);
  }

  _renderHelp() {
    if (!this._helpText) return;
    const rows = process.stdout.rows || 24;
    const cols = process.stdout.columns || 80;
    process.stdout.write('\x1b[2J\x1b[H');
    const lines = this._helpText.split('\n');
    const startRow = Math.max(1, Math.floor((rows - lines.length) / 2));
    const startCol = Math.max(1, Math.floor((cols - 40) / 2));
    lines.forEach((line, i) => {
      process.stdout.write(`\x1b[${startRow + i};${startCol}H${line}`);
    });
    this._renderStatusBar();
  }
}

export default Screen;
