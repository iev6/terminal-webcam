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
    width: width,        // Full width (no borders)
    height: height - 2   // Leave 2 rows for status bar
  };
}

export {
  getTerminalSize,
  getVideoBoxDimensions
};
