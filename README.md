# Terminal Webcam

A Terminal User Interface (TUI) application that displays a live webcam feed directly in your terminal using grayscale block characters for real-time video rendering.

## Features

- **Live Webcam Feed**: Real-time video streaming in your terminal
- **Grayscale Display**: High-quality grayscale rendering using block characters (░▒▓█)
- **Snapshot Capture**: Save still images from the live feed
- **Performance Monitoring**: Real-time FPS counter and resolution display
- **Keyboard Controls**: Simple and intuitive keyboard shortcuts
- **Terminal Responsive**: Automatically adapts to terminal window size

## Prerequisites

- **Node.js**: v14 or higher
- **Webcam**: System webcam (built-in or external)
- **Terminal**: Modern terminal with ANSI color support
  - Recommended: iTerm2, Terminal.app, Alacritty, Hyper
- **Permissions**: Webcam access permissions for terminal/Node.js

## Installation

```bash
# Navigate to the project directory
cd terminal-webcam

# Install dependencies
npm install
```

## Usage

### Start the Application

```bash
npm start
```

Or run directly:

```bash
node src/index.js
```

### Keyboard Controls

| Key | Action |
|-----|--------|
| `q`, `ESC` | Quit application |
| `h`, `?` | Toggle help overlay |
| `s` | Save snapshot to `snapshots/` directory |
| `Ctrl+C` | Force quit |

## Configuration

Edit `src/webcam/config.js` to customize:

```javascript
{
  targetFPS: 20,          // Target frames per second (optimized for smooth continuous playback)
  width: 1024,            // Webcam capture width (optimized for performance)
  height: 576,            // Webcam capture height
  quality: 75,            // JPEG quality (0-100, optimized for speed)
  output: 'jpeg',         // Output format
  device: null            // Camera device (null = default)
}
```

## Project Structure

```
terminal-webcam/
├── src/
│   ├── index.js              # Main entry point
│   ├── webcam/
│   │   ├── capture.js        # Webcam frame capture logic
│   │   └── config.js         # Camera configuration
│   ├── renderer/
│   │   ├── terminal.js       # Terminal rendering engine
│   │   └── converter.js      # Image to ASCII/grayscale conversion
│   ├── ui/
│   │   ├── screen.js         # Blessed screen setup
│   │   └── controls.js       # Keyboard controls
│   └── utils/
│       └── terminal-size.js  # Terminal dimension detection
├── package.json
├── .gitignore
└── README.md
```

## Dependencies

- **node-webcam**: Webcam capture interface
- **blessed**: Terminal UI framework
- **sharp**: High-performance image processing
- **chalk**: Terminal styling

## How It Works

1. **Continuous Capture**: Camera stays on throughout the session, capturing frames in a continuous loop
2. **Pipeline Processing**: Independent capture and render loops work in parallel:
   - Capture loop continuously grabs frames from webcam (as fast as possible)
   - Render loop picks up latest frame at 20 FPS for processing
3. **Zero-Copy Processing**: `sharp` reads directly from file, resizes to terminal dimensions, converts to grayscale
4. **ASCII Conversion**: Converts pixel data to grayscale block characters (░▒▓█) using optimized array buffers
5. **Batched Rendering**: Updates displayed in terminal using `blessed` with batched render calls to minimize overhead

### Performance Optimizations

The application has been highly optimized for smooth continuous playback:

- **Continuous Camera Pipeline**: Camera stays on throughout session, eliminating startup/shutdown overhead and blinking
- **Parallel Processing**: Independent capture and render loops work concurrently for maximum throughput
- **Batched Rendering**: Screen updates are batched using `setImmediate` to render only once per frame cycle
- **Zero-Copy I/O**: Sharp reads directly from the webcam temp file, eliminating redundant buffer copies
- **Array Buffers**: ASCII conversion uses array buffers instead of string concatenation for 2-3x speedup
- **Optimized Settings**: Balanced resolution (1024x576) and JPEG quality (75) for speed without sacrificing visual quality

## Troubleshooting

### Webcam Not Found

Ensure your terminal/Node.js has webcam access permissions:
- **macOS**: System Preferences → Security & Privacy → Camera
- **Linux**: Check `/dev/video*` permissions
- **Windows**: Check Camera privacy settings

### Camera Blinking or Stuttering

The application uses continuous capture mode to keep the camera on. If you still experience issues:

- **Camera light should stay on continuously** (not blink) - this is normal behavior
- Reduce `targetFPS` in config (try 15 or 10) if rendering stutters
- Decrease webcam resolution further (e.g., 800x450) for lower-end systems
- Lower JPEG `quality` setting (try 60-70)
- Close other applications using the webcam
- Use a GPU-accelerated terminal (iTerm2, Alacritty, WezTerm)
- Ensure your terminal font rendering is hardware-accelerated
- Note: Display may be 1-2 frames behind real-time for smoothness (this is normal)

### Display Issues

- Ensure terminal supports UTF-8 characters (for block characters)
- Try a different terminal emulator
- Adjust terminal font size for better aspect ratio
- Enable GPU acceleration in terminal settings

### Permission Errors

```bash
# macOS: Grant camera access to Terminal/iTerm2
# Then restart the terminal application
```

## Snapshots

Saved snapshots are stored in `snapshots/` directory with timestamps:
```
snapshots/
├── snapshot-2025-12-13T10-30-45-123Z.jpg
├── snapshot-2025-12-13T10-31-02-456Z.jpg
└── ...
```

## Performance Tips

The application now achieves smooth 20 FPS continuous playback. To maximize performance:

- **Terminal Size**: Smaller terminal windows = higher FPS (fewer characters to render)
- **FPS Target**: Default 20 FPS provides smooth playback; increase to 30 for high-end machines
- **Resolution**: 1024x576 provides excellent quality/performance balance
- **Terminal**: Use GPU-accelerated terminals for best results:
  - **macOS**: iTerm2, Alacritty, WezTerm
  - **Linux**: Alacritty, Kitty, WezTerm
  - **Windows**: Windows Terminal, Alacritty
- **Hardware**: SSD improves temp file I/O; multi-core CPU helps with image processing
- **Smoothness**: Display may lag 1-2 frames behind real-time, prioritizing smooth continuous playback

## Known Limitations

- Display is grayscale only (using block characters ░▒▓█)
- Performance depends on terminal rendering speed (GPU acceleration recommended)
- Aspect ratio may vary between different terminals and font configurations
- Disk I/O still required for webcam capture (limitation of node-webcam library)
- Camera light stays on continuously during operation (this is intentional for smooth video)

## Future Enhancements

- Video recording capability
- Image filters and effects (grayscale, edge detection, etc.)
- Multiple camera support
- Configuration UI
- Snapshot gallery viewer
- Export to animated GIF

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Credits

Built with:
- [node-webcam](https://github.com/chuckfairy/node-webcam)
- [blessed](https://github.com/chjj/blessed)
- [sharp](https://github.com/lovell/sharp)
- [chalk](https://github.com/chalk/chalk)
