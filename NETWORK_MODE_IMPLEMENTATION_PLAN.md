# Two-Way Terminal Video Streaming - Complete Implementation Plan

## Overview

This document provides a comprehensive plan for adding network streaming mode to the terminal webcam application. Two users can see each other's webcam feeds side-by-side in their terminals by connecting via room codes through a WebSocket relay server.

**Feature Summary:**
- Display: Side-by-side split screen (50% width each)
- Networking: WebSocket with central relay server
- Pairing: Room code system (e.g., "happy-cat-742")
- Data format: ASCII frames (~2KB/frame at 20 FPS)
- Bandwidth: ~0.5 Mbps bidirectional (very light)
- Latency target: <200ms end-to-end

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Application Modes](#application-modes)
3. [Server Implementation](#server-implementation)
4. [Client Implementation](#client-implementation)
5. [UI Changes](#ui-changes)
6. [Message Protocol](#message-protocol)
7. [File Structure](#file-structure)
8. [Implementation Steps](#implementation-steps)
9. [Testing Strategy](#testing-strategy)
10. [Error Handling](#error-handling)
11. [Performance Targets](#performance-targets)

---

## Architecture Overview

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER A TERMINAL                         │
├──────────────────┬──────────────────────────────────────────────┤
│  Local Stream    │  Remote Stream (User B)                      │
│  (50% width)     │  (50% width)                                 │
│                  │                                              │
│  [Your camera]   │  [Partner's camera]                          │
│                  │                                              │
├──────────────────┴──────────────────────────────────────────────┤
│  Status: Connected to room abc-123 | Local: 20 FPS | Remote: 19│
└─────────────────────────────────────────────────────────────────┘
         ▲                                    │
         │ ASCII frames (~2KB @ 20fps)        │
         │                                    ▼
    ┌────┴────────────────────────────────────────┐
    │         WebSocket Relay Server              │
    │  - Room management (abc-123, xyz-789...)    │
    │  - Message routing (frame relay)            │
    │  - Connection lifecycle                     │
    └────┬────────────────────────────────────────┘
         │                                    ▲
         ▼ ASCII frames (~2KB @ 20fps)        │
┌─────────────────────────────────────────────────────────────────┐
│                         USER B TERMINAL                         │
├──────────────────┬──────────────────────────────────────────────┤
│  Local Stream    │  Remote Stream (User A)                      │
│  (50% width)     │  (50% width)                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Frame Transmission (User A → User B):**
```
[User A]
  Webcam → HybridCapture.getLatestFrame()
    → ImageConverter.convertToTerminal() → ASCII string (~2KB)
    → WebSocketClient.sendFrame() → {type: 'frame', data: '...'}
    → Server relay → [User B] WebSocketClient receives
    → NetworkRenderer.handleRemoteFrame() → Screen.updateRemoteVideo()
    → Display in remote box
```

**Connection Establishment:**
```
User A: npm start -- --network --room abc-123
  → NetworkMode.initialize()
  → WebSocketClient.connect(ws://localhost:3000)
  → Send: {type: 'join', room: 'abc-123', peerId: 'user-a-id'}
  → Server: Add to room, notify User B if present
  → User B receives: {type: 'peer-joined', peerId: 'user-a-id'}
  → Both start sending/receiving frames
```

---

## Application Modes

### Mode Selection

The application supports two modes:

1. **Solo Mode** (existing behavior)
   - Single-user webcam display
   - No networking
   - Command: `npm start`

2. **Network Mode** (new feature)
   - Two-user video streaming
   - WebSocket connection required
   - Command: `npm start -- --network --room <code>`

### CLI Arguments

```bash
# Solo mode (existing)
npm start

# Network mode - interactive (prompts for room)
npm start -- --network

# Network mode - join specific room
npm start -- --network --room abc-123
npm start -- -n -r abc-123                # Short form

# Network mode - custom server
npm start -- -n -r abc-123 -s ws://example.com:3000

# Show help
npm start -- --help
```

**CLI Options:**
- `-n, --network` - Enable network streaming mode
- `-r, --room CODE` - Room code to join
- `-s, --server URL` - WebSocket server URL (default: ws://localhost:3000)
- `-h, --help` - Show help message

---

## Server Implementation

### Server Architecture

The WebSocket server is lightweight and handles:
1. Room management (create, join, leave)
2. Message routing (relay frames between peers)
3. Connection lifecycle (cleanup on disconnect)

### File Structure

```
server/
├── index.js              # Server entry point
├── room-manager.js       # Room state management
├── message-router.js     # Message handling & relay
└── package.json          # Dependencies (ws)
```

### server/index.js

Main server entry point:

```javascript
import { WebSocketServer } from 'ws';
import RoomManager from './room-manager.js';
import MessageRouter from './message-router.js';

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });
const roomManager = new RoomManager();
const messageRouter = new MessageRouter(roomManager);

wss.on('connection', (ws) => {
  const clientId = generateClientId();

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    messageRouter.handleMessage(clientId, ws, message);
  });

  ws.on('close', () => {
    roomManager.handleDisconnect(clientId);
  });

  ws.on('error', (error) => {
    console.error(`Client ${clientId} error:`, error);
  });
});

function generateClientId() {
  return `client-${Math.random().toString(36).substring(2, 9)}`;
}

console.log(`WebSocket server running on ws://localhost:${PORT}`);
```

### server/room-manager.js

Manages room state and membership:

```javascript
class RoomManager {
  constructor() {
    this.rooms = new Map();      // roomCode → { members: Set<clientId> }
    this.clients = new Map();    // clientId → { ws, roomCode, peerId }
  }

  // Generate friendly room code (e.g., "happy-cat-742")
  generateRoomCode() {
    const adjectives = ['happy', 'sunny', 'bright', 'clever', 'gentle', 'swift'];
    const nouns = ['cat', 'dog', 'bird', 'fox', 'owl', 'bear'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}-${noun}-${num}`;
  }

  // Join a room
  joinRoom(clientId, ws, roomCode, peerId) {
    // Validate room exists or create it
    if (!this.rooms.has(roomCode)) {
      this.rooms.set(roomCode, { members: new Set() });
    }

    const room = this.rooms.get(roomCode);

    // Check capacity (max 2 members)
    if (room.members.size >= 2) {
      return { success: false, error: 'Room is full (max 2 people)' };
    }

    // Add client
    room.members.add(clientId);
    this.clients.set(clientId, { ws, roomCode, peerId });

    // Get peer info if exists
    const peerInfo = this._getPeerInfo(clientId);

    return {
      success: true,
      roomCode,
      waiting: room.members.size === 1,
      peerInfo
    };
  }

  // Leave room
  leaveRoom(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const room = this.rooms.get(client.roomCode);
    if (room) {
      room.members.delete(clientId);

      // Cleanup empty rooms
      if (room.members.size === 0) {
        this.rooms.delete(client.roomCode);
      }
    }

    this.clients.delete(clientId);
  }

  // Get peer in same room
  getPeerInRoom(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return null;

    const room = this.rooms.get(client.roomCode);
    if (!room) return null;

    // Find the other member
    for (const memberId of room.members) {
      if (memberId !== clientId) {
        return this.clients.get(memberId);
      }
    }

    return null;
  }

  // Get peer info (without ws connection)
  _getPeerInfo(clientId) {
    const peer = this.getPeerInRoom(clientId);
    if (!peer) return null;
    return { peerId: peer.peerId };
  }

  // Handle disconnect
  handleDisconnect(clientId) {
    // Notify peer before leaving
    const peer = this.getPeerInRoom(clientId);
    if (peer) {
      const client = this.clients.get(clientId);
      peer.ws.send(JSON.stringify({
        type: 'peer-left',
        peerId: client.peerId
      }));
    }

    this.leaveRoom(clientId);
  }
}

export default RoomManager;
```

### server/message-router.js

Routes messages between peers:

```javascript
class MessageRouter {
  constructor(roomManager) {
    this.roomManager = roomManager;
  }

  handleMessage(clientId, ws, message) {
    const { type, ...payload } = message;

    switch (type) {
      case 'join':
        return this.handleJoin(clientId, ws, payload);
      case 'leave':
        return this.handleLeave(clientId);
      case 'frame':
        return this.handleFrame(clientId, payload);
      case 'ping':
        return this.handlePing(clientId, ws);
      default:
        console.warn(`Unknown message type: ${type}`);
    }
  }

  handleJoin(clientId, ws, { roomCode, peerId }) {
    const result = this.roomManager.joinRoom(clientId, ws, roomCode, peerId);

    if (result.success) {
      // Confirm join to client
      ws.send(JSON.stringify({
        type: 'joined',
        roomCode: result.roomCode,
        waiting: result.waiting
      }));

      // Notify peer if they exist
      const peer = this.roomManager.getPeerInRoom(clientId);
      if (peer) {
        peer.ws.send(JSON.stringify({
          type: 'peer-joined',
          peerId
        }));
      }
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: result.error
      }));
    }
  }

  handleFrame(clientId, { data, timestamp }) {
    // Get peer in same room
    const peer = this.roomManager.getPeerInRoom(clientId);

    if (peer) {
      // Relay frame to peer (performance-critical path)
      peer.ws.send(JSON.stringify({
        type: 'frame',
        data,
        timestamp
      }));
    }
  }

  handleLeave(clientId) {
    this.roomManager.leaveRoom(clientId);
  }

  handlePing(clientId, ws) {
    ws.send(JSON.stringify({
      type: 'pong',
      timestamp: Date.now()
    }));
  }
}

export default MessageRouter;
```

### server/package.json

```json
{
  "name": "terminal-webcam-server",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "ws": "^8.18.0"
  },
  "scripts": {
    "start": "node index.js"
  }
}
```

---

## Client Implementation

### Client Architecture

The client consists of:
1. **WebSocketClient** - Connection management with auto-reconnect
2. **NetworkRenderer** - Dual-stream rendering (local + remote)
3. **NetworkMode** - Orchestrator that wires everything together

### File Structure

```
src/
├── network/
│   ├── websocket-client.js    # WebSocket client with reconnection
│   └── network-renderer.js    # Dual-stream renderer
└── modes/
    ├── mode-manager.js        # Mode factory & CLI parsing
    ├── solo-mode.js           # Refactored existing behavior
    └── network-mode.js        # Network mode orchestrator
```

### src/network/websocket-client.js

WebSocket client with reconnection logic:

```javascript
import WebSocket from 'ws';
import EventEmitter from 'events';

class WebSocketClient extends EventEmitter {
  constructor(serverUrl) {
    super();
    this.serverUrl = serverUrl;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Connect to server
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this._handleMessage(message);
        } catch (error) {
          console.error('Message parse error:', error);
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        this._attemptReconnect();
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    });
  }

  // Join a room
  joinRoom(roomCode, peerId) {
    this._send({ type: 'join', roomCode, peerId });
  }

  // Send video frame
  sendFrame(asciiData) {
    if (!this.connected) return;
    this._send({
      type: 'frame',
      data: asciiData,
      timestamp: Date.now()
    });
  }

  // Leave room
  leaveRoom() {
    this._send({ type: 'leave' });
  }

  // Handle incoming messages
  _handleMessage(message) {
    const { type, ...payload } = message;

    switch (type) {
      case 'joined':
        this.emit('joined', payload);
        break;
      case 'peer-joined':
        this.emit('peer-joined', payload);
        break;
      case 'peer-left':
        this.emit('peer-left', payload);
        break;
      case 'frame':
        this.emit('frame', payload);
        break;
      case 'error':
        this.emit('server-error', payload);
        break;
      case 'pong':
        this.emit('pong', payload);
        break;
    }
  }

  // Send message to server
  _send(message) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // Reconnect logic with exponential backoff
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect-failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    setTimeout(() => {
      this.emit('reconnecting', this.reconnectAttempts);
      this.connect().catch(() => {});
    }, delay);
  }

  // Cleanup
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

export default WebSocketClient;
```

### src/network/network-renderer.js

Manages dual rendering (local + remote streams):

```javascript
import ImageConverter from '../renderer/converter.js';

class NetworkRenderer {
  constructor(localCapture, wsClient, config) {
    this.localCapture = localCapture;
    this.wsClient = wsClient;
    this.config = config;
    this.converter = new ImageConverter();

    this.isRunning = false;
    this.latestLocalFrame = '';
    this.latestRemoteFrame = 'Waiting for peer...';

    // Stats tracking
    this.localFps = 0;
    this.remoteFps = 0;
    this.lastLocalUpdate = Date.now();
    this.lastRemoteUpdate = Date.now();
    this.localFrameCount = 0;
    this.remoteFrameCount = 0;
  }

  start(onFrameUpdate, onStatsUpdate) {
    this.isRunning = true;
    this.onFrameUpdate = onFrameUpdate;
    this.onStatsUpdate = onStatsUpdate;

    // Listen for remote frames
    this.wsClient.on('frame', ({ data }) => {
      this.handleRemoteFrame(data);
    });

    // Start local capture loop
    this._startLocalLoop();
  }

  async _startLocalLoop() {
    if (!this.isRunning) return;

    setTimeout(async () => {
      try {
        // Capture local frame
        const frameBuffer = this.localCapture.getLatestFrame();

        if (frameBuffer) {
          const dimensions = this._getLocalDimensions();

          // Convert to ASCII (half width for split screen)
          const asciiFrame = await this.converter.convertToTerminal(
            frameBuffer,
            dimensions.width,
            dimensions.height
          );

          // Update local display
          this.latestLocalFrame = asciiFrame;

          // Send to peer via WebSocket
          this.wsClient.sendFrame(asciiFrame);

          // Trigger UI update
          if (this.onFrameUpdate) {
            this.onFrameUpdate({
              local: this.latestLocalFrame,
              remote: this.latestRemoteFrame
            });
          }

          this._updateLocalStats();
        }
      } catch (error) {
        console.error('Local render error:', error);
      }

      this._startLocalLoop();
    }, this.config.delay);
  }

  handleRemoteFrame(asciiData) {
    this.latestRemoteFrame = asciiData;
    this.remoteFrameCount++;

    // Trigger UI update
    if (this.onFrameUpdate) {
      this.onFrameUpdate({
        local: this.latestLocalFrame,
        remote: this.latestRemoteFrame
      });
    }

    this._updateRemoteStats();
  }

  _updateLocalStats() {
    this.localFrameCount++;
    const now = Date.now();
    const elapsed = now - this.lastLocalUpdate;

    if (elapsed >= 1000) {
      this.localFps = Math.round((this.localFrameCount * 1000) / elapsed);
      this.localFrameCount = 0;
      this.lastLocalUpdate = now;

      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          localFps: this.localFps,
          remoteFps: this.remoteFps
        });
      }
    }
  }

  _updateRemoteStats() {
    this.remoteFrameCount++;
    const now = Date.now();
    const elapsed = now - this.lastRemoteUpdate;

    if (elapsed >= 1000) {
      this.remoteFps = Math.round((this.remoteFrameCount * 1000) / elapsed);
      this.remoteFrameCount = 0;
      this.lastRemoteUpdate = now;

      if (this.onStatsUpdate) {
        this.onStatsUpdate({
          localFps: this.localFps,
          remoteFps: this.remoteFps
        });
      }
    }
  }

  _getLocalDimensions() {
    // Half width for split screen
    return {
      width: Math.floor((process.stdout.columns - 2) / 2),
      height: process.stdout.rows - 4
    };
  }

  stop() {
    this.isRunning = false;
  }
}

export default NetworkRenderer;
```

### src/modes/network-mode.js

Network mode orchestrator:

```javascript
import HybridCapture from '../webcam/hybrid-capture.js';
import NetworkScreen from '../ui/network-screen.js';
import NetworkRenderer from '../network/network-renderer.js';
import WebSocketClient from '../network/websocket-client.js';
import Controls from '../ui/controls.js';
import config from '../webcam/config.js';

class NetworkMode {
  constructor(options) {
    this.serverUrl = options.server || 'ws://localhost:3000';
    this.roomCode = options.room || null;
    this.isRunning = false;

    this.webcam = null;
    this.wsClient = null;
    this.renderer = null;
    this.screen = null;
    this.controls = null;
  }

  async start() {
    try {
      // 1. Setup WebSocket client
      this.wsClient = new WebSocketClient(this.serverUrl);
      this._setupWebSocketListeners();

      // 2. Connect to server
      console.log(`Connecting to ${this.serverUrl}...`);
      await this.wsClient.connect();
      console.log('Connected!');

      // 3. Get or generate room code
      if (!this.roomCode) {
        this.roomCode = this._generateRoomCode();
        console.log(`\nGenerated room code: ${this.roomCode}`);
        console.log('Share this code with your partner!\n');
      }

      // 4. Join room
      const peerId = this._generatePeerId();
      this.wsClient.joinRoom(this.roomCode, peerId);
      await this._waitForJoin();

      // 5. Initialize UI
      this.screen = new NetworkScreen();
      this.screen.initialize(this.roomCode);
      this.screen.updateConnectionStatus('connected', this.roomCode);

      // 6. Setup controls
      this.controls = new Controls(this.screen.getScreen());
      this.controls.setup(() => this.quit());

      // 7. Initialize webcam
      const dimensions = this._getLocalDimensions();
      this.webcam = new HybridCapture();
      await this.webcam.initialize(dimensions.width, dimensions.height);

      // 8. Start network renderer
      this.renderer = new NetworkRenderer(this.webcam, this.wsClient, config);
      this.renderer.start(
        (frames) => this.screen.updateVideo(frames),
        (stats) => this.screen.updateStats(stats)
      );

      this.isRunning = true;
      console.log(`Joined room: ${this.roomCode}`);
      console.log('Waiting for peer...\n');

    } catch (error) {
      console.error('Failed to start network mode:', error);
      this.quit(1);
    }
  }

  _setupWebSocketListeners() {
    this.wsClient.on('peer-joined', ({ peerId }) => {
      console.log(`Peer joined: ${peerId}`);
      if (this.screen) {
        this.screen.showNotification('Partner connected!');
      }
    });

    this.wsClient.on('peer-left', ({ peerId }) => {
      console.log(`Peer left: ${peerId}`);
      if (this.screen) {
        this.screen.showNotification('Partner disconnected');
      }
    });

    this.wsClient.on('disconnected', () => {
      if (this.screen) {
        this.screen.updateConnectionStatus('disconnected');
      }
    });

    this.wsClient.on('reconnecting', (attempt) => {
      console.log(`Reconnecting... (attempt ${attempt})`);
      if (this.screen) {
        this.screen.updateConnectionStatus('connecting');
      }
    });

    this.wsClient.on('server-error', ({ message }) => {
      console.error('Server error:', message);
      if (this.screen) {
        this.screen.showNotification(`Error: ${message}`);
      }
    });
  }

  _waitForJoin() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join timeout'));
      }, 10000);

      this.wsClient.once('joined', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.wsClient.once('server-error', ({ message }) => {
        clearTimeout(timeout);
        reject(new Error(message));
      });
    });
  }

  _generateRoomCode() {
    return `room-${Math.random().toString(36).substring(2, 8)}`;
  }

  _generatePeerId() {
    return `user-${Math.random().toString(36).substring(2, 9)}`;
  }

  _getLocalDimensions() {
    return {
      width: Math.floor((process.stdout.columns - 2) / 2),
      height: process.stdout.rows - 4
    };
  }

  async quit(exitCode = 0) {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.renderer) this.renderer.stop();
    if (this.wsClient) {
      this.wsClient.leaveRoom();
      this.wsClient.disconnect();
    }
    if (this.webcam) await this.webcam.cleanup();
    if (this.screen) this.screen.destroy();

    process.exit(exitCode);
  }
}

export default NetworkMode;
```

---

## UI Changes

### New Split-Screen Layout

**File:** `src/ui/network-screen.js`

```javascript
import blessed from 'blessed';
import chalk from 'chalk';

class NetworkScreen {
  constructor() {
    this.screen = null;
    this.localVideoBox = null;
    this.remoteVideoBox = null;
    this.statusBar = null;
    this.connectionStatus = 'disconnected';
    this.roomCode = '';
    this.localFps = 0;
    this.remoteFps = 0;
  }

  initialize(roomCode) {
    this.roomCode = roomCode;

    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: 'Terminal Webcam - Network Mode'
    });

    // LEFT: Local video (50% width)
    this.localVideoBox = blessed.text({
      top: 0,
      left: 0,
      width: '50%-1',
      height: '100%-2',
      content: 'Initializing local webcam...',
      tags: false,
      border: { type: 'line', fg: 'cyan' },
      label: ' You ',
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      }
    });

    // RIGHT: Remote video (50% width)
    this.remoteVideoBox = blessed.text({
      top: 0,
      left: '50%',
      width: '50%-1',
      height: '100%-2',
      content: 'Waiting for peer...',
      tags: false,
      border: { type: 'line', fg: 'magenta' },
      label: ' Partner ',
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'magenta' }
      }
    });

    // Status bar
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

    this.screen.append(this.localVideoBox);
    this.screen.append(this.remoteVideoBox);
    this.screen.append(this.statusBar);

    this.screen.render();
  }

  updateVideo({ local, remote }) {
    if (this.localVideoBox) {
      this.localVideoBox.setContent(local);
    }
    if (this.remoteVideoBox) {
      this.remoteVideoBox.setContent(remote);
    }
    this._scheduleRender();
  }

  updateConnectionStatus(status, roomCode = null) {
    this.connectionStatus = status;
    if (roomCode) this.roomCode = roomCode;
    this.statusBar.setContent(this._getStatusText());
    this._scheduleRender();
  }

  updateStats({ localFps, remoteFps }) {
    this.localFps = localFps;
    this.remoteFps = remoteFps;
    this.statusBar.setContent(this._getStatusText());
    this._scheduleRender();
  }

  showNotification(message) {
    const notification = blessed.box({
      top: 'center',
      left: 'center',
      width: 'shrink',
      height: 'shrink',
      content: `  ${message}  `,
      border: { type: 'line' },
      style: {
        fg: 'white',
        bg: 'green',
        border: { fg: 'green' }
      }
    });

    this.screen.append(notification);
    this.screen.render();

    setTimeout(() => {
      this.screen.remove(notification);
      this.screen.render();
    }, 2000);
  }

  _getStatusText() {
    const statusColors = {
      connected: chalk.green,
      connecting: chalk.yellow,
      disconnected: chalk.red
    };

    const statusColor = statusColors[this.connectionStatus] || chalk.gray;
    const statusText = statusColor(this.connectionStatus.toUpperCase());
    const roomText = this.roomCode ? chalk.cyan(`Room: ${this.roomCode}`) : '';
    const fpsText = this.localFps
      ? chalk.yellow(`Local: ${this.localFps} FPS | Remote: ${this.remoteFps} FPS`)
      : '';

    return ` ${statusText} ${roomText} | ${fpsText} | ${chalk.green('q=quit')}`;
  }

  _scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    setImmediate(() => {
      this.screen.render();
      this.renderScheduled = false;
    });
  }

  getScreen() {
    return this.screen;
  }

  destroy() {
    if (this.screen) {
      this.screen.destroy();
    }
  }
}

export default NetworkScreen;
```

### Layout Visualization

```
Terminal (100 cols × 30 rows):

┌────────────────────────────┬───────────────────────────┐
│        YOU (Local)         │     PARTNER (Remote)      │
│                            │                           │
│   ████████████████         │    ░░░░░░░░░░░░░░        │
│   ██░░░░░░░░░░░░██         │    ░░██████████░░        │
│   ██░░████████░░██         │    ░░██░░░░░░██░░        │
│   ██░░██░░░░██░░██         │    ░░██░░██░░██░░        │
│   ██░░████████░░██         │    ░░██████████░░        │
│   ██░░░░░░░░░░░░██         │    ░░░░░░░░░░░░░░        │
│   ████████████████         │    ░░░░░░░░░░░░░░        │
│                            │                           │
│  49 cols × 26 rows         │  49 cols × 26 rows        │
├────────────────────────────┴───────────────────────────┤
│ CONNECTED Room: abc-123 | Local: 20 FPS | Remote: 19  │
│ FPS | q=quit                                           │
└────────────────────────────────────────────────────────┘
```

---

## Message Protocol

### Message Types

#### Client → Server

```javascript
// Join a room
{
  type: 'join',
  roomCode: string,     // e.g., "abc-123"
  peerId: string        // e.g., "user-a-1234"
}

// Leave current room
{
  type: 'leave'
}

// Send video frame (performance-critical)
{
  type: 'frame',
  data: string,         // ASCII frame content (~2KB)
  timestamp: number     // For latency tracking
}

// Ping server (health check)
{
  type: 'ping',
  timestamp: number
}
```

#### Server → Client

```javascript
// Successfully joined room
{
  type: 'joined',
  roomCode: string,
  waiting: boolean      // True if no peer yet
}

// Peer joined your room
{
  type: 'peer-joined',
  peerId: string
}

// Peer left your room
{
  type: 'peer-left',
  peerId: string
}

// Incoming video frame
{
  type: 'frame',
  data: string,         // ASCII frame content
  timestamp: number     // Echo for RTT calculation
}

// Error occurred
{
  type: 'error',
  message: string       // e.g., "Room full"
}

// Pong response
{
  type: 'pong',
  timestamp: number
}
```

---

## File Structure

### Complete Project Structure

```
terminal-webcam/
├── src/
│   ├── index.js                    [MODIFIED] - CLI parsing, mode delegation
│   ├── modes/                      [NEW DIRECTORY]
│   │   ├── mode-manager.js         [NEW] - Mode factory & CLI parsing
│   │   ├── solo-mode.js            [NEW] - Refactored existing behavior
│   │   └── network-mode.js         [NEW] - Network orchestrator
│   ├── network/                    [NEW DIRECTORY]
│   │   ├── websocket-client.js     [NEW] - WS client with reconnect
│   │   └── network-renderer.js     [NEW] - Dual stream renderer
│   ├── ui/
│   │   ├── screen.js               [EXISTING] - Solo mode UI
│   │   ├── network-screen.js       [NEW] - Split-screen UI
│   │   └── controls.js             [EXISTING] - Keyboard controls
│   ├── webcam/                     [EXISTING] - No changes needed
│   ├── renderer/                   [EXISTING] - No changes needed
│   └── utils/                      [EXISTING] - No changes needed
│
├── server/                         [NEW DIRECTORY]
│   ├── index.js                    [NEW] - Server entry point
│   ├── room-manager.js             [NEW] - Room state management
│   ├── message-router.js           [NEW] - Message handling & relay
│   └── package.json                [NEW] - Server dependencies
│
├── package.json                    [MODIFIED] - Add dependencies
└── README.md                       [MODIFIED] - Add network mode docs
```

### Modified Files

**package.json** - Add dependencies:
```json
{
  "dependencies": {
    "minimist": "^1.2.8",
    "ws": "^8.18.0"
  },
  "scripts": {
    "start:server": "cd server && npm install && npm start"
  }
}
```

**src/index.js** - Add CLI parsing:
```javascript
import minimist from 'minimist';
import ModeManager from './modes/mode-manager.js';

const args = minimist(process.argv.slice(2), {
  boolean: ['network', 'help'],
  string: ['room', 'server'],
  default: { server: 'ws://localhost:3000' }
});

if (args.help) {
  // Show help
  process.exit(0);
}

const modeManager = new ModeManager();
const modeType = args.network ? 'network' : 'solo';
const mode = modeManager.createMode(modeType, args);

await mode.start();
```

---

## Implementation Steps

### Phase 1: Server Foundation (Days 1-2)

1. Create `server/` directory
2. Implement `server/room-manager.js`:
   - Room creation and management
   - Join/leave logic (max 2 members)
   - Peer lookup
3. Implement `server/message-router.js`:
   - Message type handling
   - Frame relay logic
4. Implement `server/index.js`:
   - WebSocket server setup
   - Connection handling
5. Test server with `wscat`:
   ```bash
   npm install -g wscat
   wscat -c ws://localhost:3000
   > {"type":"join","roomCode":"test","peerId":"user1"}
   ```

### Phase 2: Client Networking (Days 3-4)

1. Create `src/network/` directory
2. Implement `websocket-client.js`:
   - Connection logic
   - Event emitter pattern
   - Reconnection with exponential backoff
3. Test connection:
   ```javascript
   const client = new WebSocketClient('ws://localhost:3000');
   await client.connect();
   client.joinRoom('test', 'user1');
   ```

### Phase 3: Mode Infrastructure (Day 5)

1. Create `src/modes/` directory
2. Implement `mode-manager.js`:
   - CLI argument parsing
   - Mode factory
3. Refactor existing code into `solo-mode.js`:
   - Move current logic from index.js
   - Encapsulate in SoloMode class
4. Verify solo mode still works:
   ```bash
   npm start
   ```

### Phase 4: Split-Screen UI (Days 6-7)

1. Create `src/ui/network-screen.js`:
   - Two blessed.text boxes (50% each)
   - Status bar with connection info
   - Notification system
2. Test with dummy data:
   ```javascript
   const screen = new NetworkScreen();
   screen.initialize('test-123');
   screen.updateVideo({
     local: 'Local ASCII...',
     remote: 'Remote ASCII...'
   });
   ```
3. Test on different terminal sizes (80-200 cols)

### Phase 5: Network Renderer (Days 8-9)

1. Create `src/network/network-renderer.js`:
   - Local capture loop
   - Remote frame handler
   - Dual FPS tracking
2. Integration with ImageConverter
3. Test frame transmission:
   ```javascript
   const renderer = new NetworkRenderer(webcam, wsClient, config);
   renderer.start(
     (frames) => console.log('Frames:', frames),
     (stats) => console.log('Stats:', stats)
   );
   ```

### Phase 6: Network Mode Orchestrator (Day 10)

1. Create `src/modes/network-mode.js`:
   - Initialize all components
   - WebSocket event handling
   - Lifecycle management
2. Wire everything together
3. Test end-to-end:
   ```bash
   # Terminal 1: Server
   cd server && npm start

   # Terminal 2: User A
   npm start -- --network --room test

   # Terminal 3: User B
   npm start -- --network --room test
   ```

### Phase 7: Error Handling (Days 11-12)

1. Add reconnection logic to WebSocketClient
2. Error states in NetworkScreen
3. Test failure scenarios:
   - Server crash during call
   - Network disconnect
   - Room full
   - Invalid room code

### Phase 8: Testing & Documentation (Days 13-14)

1. Full testing checklist (see below)
2. Performance profiling
3. Update README with:
   - Network mode usage
   - Server setup instructions
   - Troubleshooting guide

---

## Testing Strategy

### Local Testing Setup

**Three Terminal Windows:**

```bash
# Terminal 1: WebSocket Server
cd server
npm install
npm start
# → Server running on ws://localhost:3000

# Terminal 2: User A
npm start -- --network --room test-123
# → Local stream on left, waiting for peer on right

# Terminal 3: User B
npm start -- --network --room test-123
# → Both users now see each other
```

### Testing Checklist

**Basic Functionality:**
- [ ] Server starts without errors
- [ ] Client connects to server
- [ ] Room creation works
- [ ] Room joining works (valid code)
- [ ] Room joining fails (invalid code)
- [ ] Room joining fails (full room)
- [ ] Local stream displays in left box
- [ ] Remote stream displays in right box
- [ ] Frames transmit at ~20 FPS
- [ ] Both users can see each other
- [ ] Quit command cleans up properly

**Error Handling:**
- [ ] Server crash → client shows reconnecting
- [ ] Client disconnect → peer notified
- [ ] Network slow → FPS degrades gracefully
- [ ] Capture failure → error frame shown
- [ ] Invalid message → ignored, doesn't crash
- [ ] Reconnection works (simulate network drop)

**Performance:**
- [ ] Bandwidth ~60 KB/s bidirectional
- [ ] Latency <200ms (measure with timestamps)
- [ ] No memory leaks (10-minute session)
- [ ] CPU usage similar to solo mode

**UI/UX:**
- [ ] Split screen renders correctly
- [ ] Status bar shows accurate info
- [ ] Room code clearly displayed
- [ ] Connection status updates in real-time
- [ ] Notifications appear/disappear correctly
- [ ] Works on various terminal sizes (80-200 cols)

---

## Error Handling

### Error Scenarios & Solutions

| Scenario | Detection | Handling |
|----------|-----------|----------|
| **Network disconnect during call** | WebSocket 'close' event | Auto-reconnect with exponential backoff (max 5 attempts). Show "Reconnecting..." status. Freeze remote frame. |
| **Room not found** | Server returns error | Show error message. Prompt to create new room or retry. |
| **Room full (>2 people)** | Server rejects join | Show "Room is full (max 2 people)". Prompt for different room. |
| **Capture failure during session** | Exception in capture loop | Show error frame locally. Continue receiving remote stream. Log error. |
| **Server unreachable** | Connection timeout (5s) | Show error before UI starts. Allow retry or fallback to solo mode. |
| **Peer never joins** | No peer-joined event | Show "Waiting for peer..." indefinitely. Allow quit anytime. |
| **Message parse error** | JSON.parse exception | Log error, ignore message, continue listening. |
| **Bandwidth degradation** | Detect slow frame rate | Reduce FPS dynamically (20→15→10). Show warning. |

### Error Handling Code Pattern

```javascript
// In network-mode.js
try {
  await this.wsClient.connect();
} catch (error) {
  console.error('Failed to connect:', error.message);
  console.log('\nPossible solutions:');
  console.log('1. Ensure server is running: cd server && npm start');
  console.log('2. Check server URL: ' + this.serverUrl);
  process.exit(1);
}

// In websocket-client.js
_attemptReconnect() {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    this.emit('reconnect-failed');
    return;
  }

  this.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

  setTimeout(() => {
    this.emit('reconnecting', this.reconnectAttempts);
    this.connect().catch(() => {});
  }, delay);
}
```

---

## Performance Targets

### Bandwidth Calculations

**Per Frame:**
- Terminal size: 50 cols × 25 rows = 1,250 characters
- JSON overhead: ~100 bytes
- **Total per frame:** ~1.3-1.5 KB

**Per Second (20 FPS):**
- Send: 1.5 KB × 20 = 30 KB/s (0.24 Mbps)
- Receive: 1.5 KB × 20 = 30 KB/s (0.24 Mbps)
- **Total bidirectional:** 60 KB/s (0.48 Mbps)

**Conclusion:** Extremely bandwidth-efficient. Works on any connection >1 Mbps.

### Latency Budget

```
End-to-end latency breakdown:

Local capture:        1-3ms  (hardware) or 2-7ms (software)
ASCII conversion:    <1ms    (negligible)
WebSocket send:       1-2ms  (serialization)
Network RTT:         10-50ms (LAN) or 50-200ms (internet)
WebSocket receive:    1-2ms  (deserialization)
UI render:            1-2ms  (blessed)
─────────────────────────────
TOTAL:              15-65ms (LAN) or 55-215ms (internet)
```

**Target:** <200ms for acceptable interactivity
**Achieved:** ✓ Yes, even on internet

### Performance Monitoring

Add latency measurement to protocol:

```javascript
// Client sends
{
  type: 'frame',
  data: asciiFrame,
  timestamp: Date.now()  // Send timestamp
}

// Server echoes timestamp back
{
  type: 'frame',
  data: asciiFrame,
  timestamp: originalTimestamp  // Echo
}

// Client calculates RTT
const rtt = Date.now() - receivedTimestamp;
console.log('Round-trip time:', rtt, 'ms');
```

---

## Future Enhancements

### Phase 2 Features (Post-MVP)
1. **Room browser** - List active public rooms
2. **Room passwords** - Private rooms with auth
3. **Recording** - Save network session to file
4. **Snapshots** - Capture both streams
5. **Text chat** - Blessed text input below video

### Phase 3 Features (Long-term)
1. **P2P mode** - Direct WebRTC (no server relay)
2. **Group calls** - 3-4 person grid (25% each)
3. **Quality controls** - User-adjustable FPS/resolution
4. **Server dashboard** - Web UI for monitoring
5. **Mobile support** - Termux on Android

---

## Quick Start Guide

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the WebSocket server
npm run start:server
# Server running on ws://localhost:3000

# 3. In another terminal, start User A
npm start -- --network
# Generated room code: happy-cat-742

# 4. In a third terminal, start User B
npm start -- --network --room happy-cat-742
# Connected! Both users see each other
```

### Usage

```bash
# Solo mode (existing behavior)
npm start

# Network mode - interactive
npm start -- --network

# Network mode - join specific room
npm start -- -n -r abc-123

# Network mode - custom server
npm start -- -n -r abc-123 -s ws://example.com:3000

# Show help
npm start -- --help
```

---

## Troubleshooting

**Problem:** "Connection timeout"
**Solution:** Ensure server is running on ws://localhost:3000

**Problem:** "Room is full"
**Solution:** Room already has 2 members. Try a different room code.

**Problem:** Video stuttering
**Solution:** Check network connection. Server will auto-adjust FPS.

**Problem:** "Cannot find module 'minimist'"
**Solution:** Run `npm install` to install dependencies

**Problem:** Split screen looks wrong
**Solution:** Terminal must be at least 80 columns wide. Resize terminal.

---

## Summary

This implementation plan provides a **minimal viable product** for two-way terminal video streaming:

✅ Clean separation between solo and network modes
✅ Lightweight WebSocket relay server
✅ Room-based pairing system
✅ Split-screen UI (50/50 width)
✅ Robust error handling and reconnection
✅ Low bandwidth (~0.5 Mbps bidirectional)
✅ Low latency (<200ms target)
✅ Maintains existing high-performance capture system

**Estimated Timeline:** 2-3 weeks for MVP
**Total New Code:** ~1000-1350 LOC
**Complexity:** Medium (networking + UI changes)
**Risk Areas:** WebSocket reliability, split-screen rendering

Follow the implementation steps in order (Phase 1 → Phase 8) to build incrementally and test at each step.
