#!/usr/bin/env node

import HybridCapture from './webcam/hybrid-capture.js';
import TerminalRenderer from './renderer/terminal.js';
import Screen from './ui/screen.js';
import Controls from './ui/controls.js';
import config, { createWebcamConfig, getOptimalCaptureResolution } from './webcam/config.js';
import { CharacterSetManager } from './renderer/character-sets.js';
import { promises as fs } from 'fs';
import path from 'path';

class TerminalWebcamApp {
  constructor() {
    this.webcam = new HybridCapture();
    this.renderer = null;
    this.screen = new Screen();
    this.controls = null;
    this.charsetManager = new CharacterSetManager();
    this.isRunning = false;
    this.snapshotCounter = 0;
    this.captureMode = null;  // 'hardware' or 'software'
    this.colorMode = false;
  }

  /**
   * Initialize and start the application
   */
  async start() {
    try {

      // Initialize UI
      this.screen.initialize();
      const screen = this.screen.getScreen();

      // Setup controls
      this.controls = new Controls(screen);
      this.controls.setup(
        () => this.quit(),
        () => this.saveSnapshot(),
        () => this.toggleLogs(),
        () => this.nextCharset(),
        () => this.prevCharset(),
        () => this.togglePerfOverlay(),
        () => this.toggleColorMode()
      );

      // Handle help toggle
      screen.on('help-toggle', () => {
        this.screen.toggleHelp(this.controls.getHelpText());
      });

      // OPTIMIZATION #2 & #3: Get terminal dimensions and initialize capture
      const { width: termWidth, height: termHeight } = this.screen.getVideoDimensions();

      // Initialize hybrid capture (tries hardware first, falls back to software)
      this.captureMode = await this.webcam.initialize(termWidth, termHeight);
      this.screen.updateStats({ mode: this.captureMode });

      // Handle terminal resize
      screen.on('resize', () => {
        const { width: newTermWidth, height: newTermHeight } = this.screen.getVideoDimensions();
        this.webcam.updateResolution(newTermWidth, newTermHeight);
      });

      // Create renderer
      this.renderer = new TerminalRenderer(this.webcam, config);

      // Set dimension provider to use screen dimensions
      this.renderer.setDimensionProvider(() => {
        return this.screen.getVideoDimensions();
      });

      // Start rendering
      this.isRunning = true;
      this.renderer.start(
        (frame) => this.onFrame(frame),
        (stats) => this.onStats(stats)
      );
      this.renderer.setPerf((timing) => this.screen.updatePerf(timing));

      this.screen.render();

    } catch (error) {
      console.error('Failed to start application:', error);
      this.quit(1);
    }
  }

  /**
   * Handle new frame
   */
  onFrame(frame) {
    if (!this.isRunning) return;
    this.screen.updateVideo(frame);
  }

  /**
   * Handle stats update
   */
  onStats(stats) {
    if (!this.isRunning) return;
    this.screen.updateStats(stats);
  }

  /**
   * Toggle color mode
   */
  toggleColorMode() {
    this.colorMode = !this.colorMode;
    this.renderer.setColorMode(this.colorMode);
    this.webcam.setColorMode(this.colorMode);
    this.screen.updateStats({ colorMode: this.colorMode });
    this.screen.showNotification(`Color mode: ${this.colorMode ? 'ON' : 'OFF'}`);
  }

  /**
   * Toggle performance logs
   */
  toggleLogs() {
    if (this.renderer) {
      const enabled = this.renderer.togglePerfLogging();
      const status = enabled ? 'ON' : 'OFF';
      this.screen.showNotification(`Performance logs: ${status}`);

      if (enabled) {
        console.log('[Logs] Performance logging enabled - stats will appear every 100 frames');
      } else {
        console.log('[Logs] Performance logging disabled');
      }
    }
  }

  /**
   * Toggle real-time perf overlay (press 'p')
   */
  togglePerfOverlay() {
    const visible = this.screen.togglePerfOverlay();
    this.screen.showNotification(`Perf overlay: ${visible ? 'ON' : 'OFF'}`);
  }

  /**
   * Switch to next character set
   */
  nextCharset() {
    const charset = this.charsetManager.next();
    if (this.renderer) {
      this.renderer.setCharacterSet(charset.chars);
    }
    this.screen.updateStats({ charsetName: charset.name });
    this.screen.showNotification(`Character set: ${charset.name} - ${charset.description}`);
  }

  /**
   * Switch to previous character set
   */
  prevCharset() {
    const charset = this.charsetManager.previous();
    if (this.renderer) {
      this.renderer.setCharacterSet(charset.chars);
    }
    this.screen.updateStats({ charsetName: charset.name });
    this.screen.showNotification(`Character set: ${charset.name} - ${charset.description}`);
  }

  /**
   * Save a snapshot
   */
  async saveSnapshot() {
    try {
      const snapshotsDir = path.join(process.cwd(), 'snapshots');
      await fs.mkdir(snapshotsDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `snapshot-${timestamp}.jpg`;
      const filepath = path.join(snapshotsDir, filename);

      const saved = await this.webcam.saveAsImage(filepath);
      if (saved) {
        this.snapshotCounter++;
        this.screen.showNotification(`Snapshot saved: ${filename}`);
      } else {
        this.screen.showNotification('No frame available');
      }
    } catch (error) {
      this.screen.showNotification('Error saving snapshot: ' + error.message);
    }
  }

  /**
   * Quit the application
   */
  async quit(exitCode = 0) {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Stop renderer
    if (this.renderer) {
      this.renderer.stop();
    }

    // Cleanup webcam
    if (this.webcam) {
      await this.webcam.cleanup();
    }

    // Destroy UI
    if (this.screen) {
      this.screen.destroy();
    }

    process.exit(exitCode);
  }

  /**
   * Handle unexpected errors
   */
  handleError(error) {
    console.error('Unexpected error:', error);
    this.quit(1);
  }
}

// Create and start the application
const app = new TerminalWebcamApp();

// Handle unexpected errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  app.quit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  app.quit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  app.quit(0);
});

process.on('SIGTERM', () => {
  app.quit(0);
});

// Start the app
app.start().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
