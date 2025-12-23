#!/usr/bin/env node

// Suppress blessed debug output globally
process.env.BLESSED_DEBUG = '0';
process.env.DEBUG = '';

import HybridCapture from './webcam/hybrid-capture.js';
import TerminalRenderer from './renderer/terminal.js';
import Screen from './ui/screen.js';
import Controls from './ui/controls.js';
import config, { createWebcamConfig, getOptimalCaptureResolution } from './webcam/config.js';
import { promises as fs } from 'fs';
import path from 'path';

class TerminalWebcamApp {
  constructor() {
    this.webcam = new HybridCapture();
    this.renderer = null;
    this.screen = new Screen();
    this.controls = null;
    this.isRunning = false;
    this.snapshotCounter = 0;
    this.captureMode = null;  // 'hardware' or 'software'
  }

  /**
   * Initialize and start the application
   */
  async start() {
    try {

      // Initialize UI
      this.screen.initialize();
      const blessedScreen = this.screen.getScreen();

      // Setup controls
      this.controls = new Controls(blessedScreen);
      this.controls.setup(
        () => this.quit(),
        () => this.saveSnapshot(),
        () => this.toggleLogs()
      );

      // Handle help toggle
      blessedScreen.on('help-toggle', () => {
        this.screen.toggleHelp(this.controls.getHelpText());
      });

      // OPTIMIZATION #2 & #3: Get terminal dimensions and initialize capture
      const { width: termWidth, height: termHeight } = this.screen.getVideoDimensions();

      // Initialize hybrid capture (tries hardware first, falls back to software)
      this.captureMode = await this.webcam.initialize(termWidth, termHeight);

      // Handle terminal resize
      blessedScreen.on('resize', () => {
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
   * Save a snapshot
   */
  async saveSnapshot() {
    try {
      // Create snapshots directory if it doesn't exist
      const snapshotsDir = path.join(process.cwd(), 'snapshots');
      await fs.mkdir(snapshotsDir, { recursive: true });

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `snapshot-${timestamp}.jpg`;
      const filepath = path.join(snapshotsDir, filename);

      if (this.captureMode === 'hardware') {
        // Hardware mode: convert raw pixels back to JPEG
        const frame = this.webcam.getLatestFrame();
        if (frame) {
          // For now, show a message that snapshots aren't supported in hardware mode
          this.screen.showNotification('Snapshot in hardware mode: coming soon');
          // TODO: Convert raw pixels to JPEG using Sharp
        } else {
          this.screen.showNotification('No frame available');
        }
      } else {
        // Software mode: copy the JPEG file
        const tmpFile = this.webcam.getLatestFramePath();
        if (tmpFile) {
          await fs.copyFile(tmpFile, filepath);
          this.snapshotCounter++;
          this.screen.showNotification(`Snapshot saved: ${filename}`);
        } else {
          this.screen.showNotification('No frame available for snapshot');
        }
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
