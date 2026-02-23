# SonosCast - Repository Analysis

## Overview

**SonosCast** is a Home Assistant add-on that creates a protocol bridge between Google Cast (Chromecast) and Sonos speakers. It discovers Sonos devices on the local network and creates virtual Google Cast devices for each speaker, allowing Cast-compatible applications to stream audio to Sonos systems.

**Primary Function**: Protocol translation layer that accepts Cast v2 protocol commands over TLS and translates them into UPnP/SOAP commands that Sonos speakers understand.

**Key Innovation**: Enables Chromecast-style casting to Sonos speakers without requiring official Sonos or Google support.

---

## Architecture

### High-Level Data Flow

```
Cast Sender App ──Cast v2 (TLS)──> Virtual Cast Device ──UPnP/SOAP──> Sonos Speaker
   (Chrome/App)                     (SonosCast Bridge)              (Physical Device)
        │                                   │                              │
        │                                   │                              │
     mDNS discovery                    Port 8009+               SSDP/UPnP discovery
```

### Core Components

#### 1. **Bridge (`bridge.js`)** - Orchestrator
- **Role**: Central coordinator that ties all components together
- **Responsibilities**:
  - Creates and manages `SonosManager` and `CastDevice` instances
  - Maintains a mapping of Sonos speakers to virtual Cast devices
  - Routes media control events from Cast devices to Sonos devices
  - Handles port allocation (sequential from base port)
  - Translates Cast media commands to Sonos UPnP actions

#### 2. **SonosManager (`sonos-manager.js`)** - Discovery
- **Role**: Sonos speaker discovery and tracking
- **Implementation**:
  - Uses `sonos` npm library's `DeviceDiscovery` for SSDP/UPnP scanning
  - Periodic re-scanning (60s interval) to detect network changes
  - Filters excluded speakers by name (case-insensitive)
  - Emits `speaker-found` and `speaker-lost` events
  - Maintains a `Map<ip, speaker>` of active speakers

#### 3. **CastDevice (`cast-device.js`)** - Virtual Cast Receiver
- **Role**: Implements a virtual Google Cast receiver device
- **Implementation**:
  - Generates self-signed TLS certificates for Cast v2 protocol
  - Creates a `CastProtocolServer` instance per speaker
  - Advertises via Bonjour mDNS (`_googlecast._tcp` service)
  - Handles Cast protocol namespaces:
    - `CONNECTION`: Client connect/disconnect
    - `HEARTBEAT`: Keep-alive pings
    - `RECEIVER`: App launch/stop, status queries
    - `MEDIA`: Load, play, pause, stop, seek, volume
    - `DEVICEAUTH`: Authentication challenges (returns error)
  - Maintains session state and media status
  - Emits media control events to the Bridge

#### 4. **CastProtocolServer (`cast-protocol.js`)** - Protocol Layer
- **Role**: Low-level Cast v2 protocol implementation
- **Implementation**:
  - TLS server accepting Cast protocol connections
  - Length-prefixed protobuf message framing (4-byte BE length + protobuf)
  - Protobuf schema definitions for `CastMessage` and `DeviceAuthMessage`
  - `PacketReader` class for streaming protobuf deserialization
  - Message routing by namespace and source/destination IDs

#### 5. **Supporting Modules**
- **Config (`config.js`)**: Loads Home Assistant add-on options from `/data/options.json`
- **Logger (`logger.js`)**: Configurable logging with component tags

### Service Management

Uses **s6-overlay** for process supervision:
- `init-sonoscast`: Initialization service (runs once)
- `sonoscast`: Main application service with auto-restart on failure
- Dependencies ensure proper startup order

---

## Technical Implementation

### Cast v2 Protocol Details

**Transport**: TLS over TCP (default port 8009)

**Message Format**:
```
[4-byte length (big-endian)] + [protobuf-encoded CastMessage]
```

**Protobuf Schema** (`CastMessage`):
```protobuf
message CastMessage {
  enum ProtocolVersion { CASTV2_1_0 = 0; }
  enum PayloadType { STRING = 0; BINARY = 1; }
  
  required ProtocolVersion protocol_version = 1;
  required string source_id = 2;       // sender-123
  required string destination_id = 3;  // receiver-0
  required string namespace = 4;       // urn:x-cast:com.google.cast.*
  required PayloadType payload_type = 5;
  optional string payload_utf8 = 6;    // JSON payload
  optional bytes payload_binary = 7;   // Binary payload (auth)
}
```

**Key Namespaces**:
- `urn:x-cast:com.google.cast.tp.connection`: `CONNECT`/`CLOSE` messages
- `urn:x-cast:com.google.cast.tp.heartbeat`: `PING`/`PONG` for keep-alive
- `urn:x-cast:com.google.cast.receiver`: `GET_STATUS`, `LAUNCH`, `STOP`
- `urn:x-cast:com.google.cast.media`: `LOAD`, `PLAY`, `PAUSE`, `STOP`, `SEEK`, `GET_STATUS`

### Sonos UPnP Integration

**Discovery**: SSDP multicast search for `urn:schemas-upnp-org:device:ZonePlayer:1`

**Control**: UPnP AVTransport SOAP actions via the `sonos` npm library:
- `setAVTransportURI(uri, metadata)`: Load media with DIDL-Lite metadata
- `play()`, `pause()`, `stop()`: Transport control
- `seek(time)`: Position seeking
- `setVolume(volume)`: Volume control (0-100)

**Metadata Format** (DIDL-Lite XML):
```xml
<DIDL-Lite>
  <item id="1" parentID="0" restricted="1">
    <dc:title>Track Title</dc:title>
    <upnp:artist>Artist Name</upnp:artist>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <res protocolInfo="http-get:*:audio/mpeg:*">http://url/to/media.mp3</res>
  </item>
</DIDL-Lite>
```

### mDNS Advertisement

Uses `bonjour-service` to advertise Cast devices with service type `_googlecast._tcp`:

**TXT Record Fields**:
- `id`: Device UUID
- `fn`: Friendly name (e.g., "Living Room (Cast)")
- `md`: Model name ("SonosCast")
- `ve`: Version ("05")
- `ca`: Capabilities bitmask
- `cd`: Device ID (first 32 chars of UUID)

---

## Configuration

**File**: `sonoscast/config.yaml`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log_level` | enum | info | Logging verbosity (trace, debug, info, notice, warning, error, fatal) |
| `base_port` | port | 8009 | Starting port for virtual Cast devices (increments per speaker) |
| `latency` | int | 0 | Audio latency compensation in milliseconds (0-5000) |
| `excluded_speakers` | list | [] | Sonos speaker names to exclude from Cast bridge |

**Example**:
```yaml
log_level: debug
base_port: 8009
latency: 100
excluded_speakers:
  - "Bathroom"
  - "Garage"
```

---

## Known Limitations & Challenges

### 1. **Device Authentication Issue** ⚠️
**Problem**: Google Cast SDK v2 includes device authentication where senders verify the receiver has a Google-signed certificate chain.

**Impact**: 
- Official Cast SDK senders (Chrome, YouTube, Google apps) **reject connections** after auth challenge fails
- Virtual devices return an `AuthError` with `NO_TLS` error type
- Authentication is a binary challenge-response with cryptographic signatures

**Workaround**: Only third-party Cast senders that skip device auth verification will work

**Potential Solutions** (not implemented):
- Proxy through a real Chromecast device (complex topology)
- Hook into sender applications to bypass auth (fragile)
- Not truly solvable without Google-signed certificates

### 2. **Audio Codec Support**
**Sonos supports**: MP3, AAC, FLAC, WAV, OGG Vorbis (HTTP/HTTPS URLs)

**Sonos does NOT support**:
- Adaptive streaming (HLS, DASH)
- Encrypted streams (DRM)
- Real-time transcoding

**Implication**: Media URLs must be direct links to supported audio formats

### 3. **Network Requirements**
- **Host networking required**: mDNS multicast doesn't work through Docker bridge
- **Same network/VLAN**: Cast senders, Home Assistant host, and Sonos speakers must be on same L2
- **Multicast enabled**: Some network configurations block mDNS/SSDP

### 4. **State Synchronization**
- No bidirectional state sync: Changes made directly to Sonos (via app/voice) don't update Cast device status
- No playback position polling from Sonos back to Cast sender

---

## Code Quality & Design Patterns

### Strengths

✅ **Event-Driven Architecture**: Clean use of EventEmitter for component communication

✅ **Separation of Concerns**: Each module has a single, well-defined responsibility

✅ **Graceful Error Handling**: Try-catch with fallback strategies (e.g., `setAVTransportURI` → `play()`)

✅ **Resource Cleanup**: Proper teardown in `stop()` methods for all components

✅ **Logging Discipline**: Consistent component-tagged log messages at appropriate levels

### Areas for Improvement

⚠️ **Limited Test Coverage**: No automated tests visible in repository

⚠️ **Hard-Coded Constants**: Magic numbers (e.g., `REDISCOVERY_INTERVAL = 60000`) could be configurable

⚠️ **Error Recovery**: No automatic reconnection logic if Cast client connection drops unexpectedly

⚠️ **State Persistence**: Media status lost on restart (not preserved)

⚠️ **Security**: Self-signed certificates generated on every start (not cached)

---

## Dependencies

### Runtime Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `bonjour-service` | ^1.2.1 | mDNS service advertisement |
| `protobufjs` | ^7.4.0 | Protocol buffer encoding/decoding |
| `selfsigned` | ^2.4.1 | Generate TLS certificates |
| `sonos` | ^1.14.0 | Sonos device control library |
| `uuid` | ^10.0.0 | Generate unique device IDs |

### System Requirements
- **Node.js**: Runtime environment
- **Debian base**: Container base image (`ghcr.io/hassio-addons/debian-base:9.2.0`)
- **s6-overlay**: Process supervision

---

## Deployment

### Docker Container Structure
```
/opt/sonoscast/          # Node.js application
├── index.js             # Entry point
├── package.json
└── lib/                 # Core modules

/etc/s6-overlay/         # Service definitions
└── s6-rc.d/
    ├── init-sonoscast/  # Initialization
    └── sonoscast/       # Main service
```

### Build Process (Dockerfile)
1. Install Node.js and npm from Debian repos
2. Copy application files to `/opt/sonoscast`
3. Run `npm install --omit=dev --omit=optional`
4. Copy s6-overlay rootfs with service definitions
5. Set metadata labels for Home Assistant add-on registry

### Supported Architectures
- `amd64` (x86_64)
- `aarch64` (ARM 64-bit, e.g., Raspberry Pi 4)

---

## Use Cases

### ✅ Working Scenarios
1. **Home Assistant Cast integration**: Direct media URL casting
2. **Custom Cast applications**: Apps that skip device authentication
3. **Third-party Cast clients**: Lightweight clients without strict auth
4. **Programmatic casting**: Direct Cast v2 protocol clients

### ❌ Not Working / Limited
1. **Chrome browser tab casting**: Enforces device authentication
2. **YouTube mobile app**: Uses official Cast SDK
3. **Spotify Connect**: Different protocol (not Cast v2)
4. **Grouped playback**: No multi-room sync with virtual devices

---

## Security Considerations

### Current Implementation
- Self-signed TLS certificates (not trusted by browsers)
- No authentication on incoming connections
- No HTTPS endpoint validation on media URLs
- Runs with `host_network: true` (full network access)

### Potential Risks
- **Man-in-the-Middle**: Self-signed certs don't prevent MITM attacks
- **Open Cast endpoints**: Anyone on network can control devices
- **URL injection**: Malicious media URLs could expose internal services
- **Resource exhaustion**: No rate limiting on connections

### Recommendations
- Add optional authentication token for Cast connections
- Implement URL allowlist/blocklist
- Consider certificate pinning for known senders
- Add connection rate limiting

---

## Future Enhancement Opportunities

### High Priority
1. **Persistent certificates**: Cache generated certs to maintain device identity
2. **State polling**: Query Sonos for current status and sync to Cast sender
3. **Group support**: Coordinate multiple Sonos speakers as Cast group
4. **Health checks**: Expose endpoint for Home Assistant health monitoring

### Medium Priority
5. **Configuration UI**: Web interface for speaker management
6. **Audio transcoding**: On-the-fly format conversion for unsupported codecs
7. **Queue management**: Multi-track playlist support
8. **Album art proxy**: Serve album artwork for media status

### Low Priority
9. **Metrics/telemetry**: Prometheus endpoint for monitoring
10. **Multi-instance**: Support multiple HA instances on same network
11. **Custom namespaces**: Support for app-specific Cast extensions

---

## Developer Notes

### Key Files to Modify

**Add a new Cast namespace handler**:
- Edit `cast-device.js` → `_onMessage()` switch statement
- Add case for new namespace
- Implement handler method (e.g., `_handleCustomNamespace()`)

**Change discovery behavior**:
- Edit `sonos-manager.js` → `_discover()` method
- Adjust `DeviceDiscovery` options or filtering logic

**Modify media translation**:
- Edit `bridge.js` → `_onLoad()`, `_onPlay()`, etc.
- Update Sonos UPnP command mapping

**Add configuration option**:
- Update `sonoscast/config.yaml` → `options` and `schema`
- Edit `app/lib/config.js` → `load()` method
- Access via `cfg.newOption` in application code

### Debugging Tips

**Enable verbose logging**:
```yaml
log_level: trace
```

**Test Cast connection manually**:
```bash
# Use catt (Cast All The Things) CLI tool
pip install catt
catt -d "Living Room (Cast)" cast http://example.com/audio.mp3
```

**Inspect mDNS advertisements**:
```bash
# Linux/macOS
avahi-browse -t _googlecast._tcp

# View protobuf messages
# Add log.trace(COMPONENT, JSON.stringify(data)) in cast-protocol.js
```

**Monitor Sonos UPnP calls**:
```javascript
// In bridge.js _onLoad()
console.log('Sonos AVTransport URI:', evt.contentId);
console.log('DIDL Metadata:', metadata);
```

---

## Conclusion

SonosCast is a well-architected protocol bridge that demonstrates solid software engineering principles: modular design, event-driven communication, and robust error handling. The implementation correctly navigates the complexity of two proprietary protocols (Cast v2 and Sonos UPnP) with minimal dependencies.

**Primary limitation** is the fundamental incompatibility with Google's device authentication scheme, which restricts practical use cases to custom/third-party Cast senders.

**Best suited for**: Home automation enthusiasts who want programmatic control of Sonos speakers via the Cast protocol, or developers building custom casting applications.

**Technical merit**: The Cast v2 protocol implementation is particularly noteworthy—handling TLS, protobuf framing, and namespace routing correctly is non-trivial. The mDNS advertisement correctly mimics real Cast devices enough to be discovered by senders.

Overall, this is a **production-grade proof-of-concept** that works within its constraints and could serve as a foundation for extended functionality or educational study of both Cast and Sonos protocols.

---

## References

- **Google Cast Protocol**: [Cast Developer Documentation](https://developers.google.com/cast)
- **Sonos UPnP**: [UPnP Device Architecture 1.0](http://upnp.org/specs/arch/UPnP-arch-DeviceArchitecture-v1.0.pdf)
- **Home Assistant Add-ons**: [Developer Docs](https://developers.home-assistant.io/docs/add-ons)
- **s6-overlay**: [GitHub Repository](https://github.com/just-containers/s6-overlay)

---

*Analysis generated: February 22, 2026*  
*Repository: SonosCast v0.1.0*  
*Analyzer: Claude (Anthropic)*
