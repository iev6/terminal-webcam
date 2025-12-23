/**
 * Get current terminal dimensions
 */
function getTerminalSize() {
  return {
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24
  };
}

/**
 * Calculate optimal video box dimensions
 * leaving room for status bar and borders
 */
function getVideoBoxDimensions() {
  const { width, height } = getTerminalSize();

  return {
    width: width - 2,      // Leave space for borders
    height: height - 4     // Leave space for status bar and borders
  };
}

export {
  getTerminalSize,
  getVideoBoxDimensions
};
