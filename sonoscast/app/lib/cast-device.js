'use strict';

const { v4: uuidv4 } = require('uuid');
const selfsigned = require('selfsigned');
const EventEmitter = require('events');
const log = require('./logger');
const {
  CastProtocolServer,
  deviceAuthType,
  CASTV2_NS_CONNECTION,
  CASTV2_NS_HEARTBEAT,
  CASTV2_NS_RECEIVER,
  CASTV2_NS_MEDIA,
  CASTV2_NS_DEVICEAUTH,
} = require('./cast-protocol');
const castAuth = require('./cast-auth');

const COMPONENT = 'CastDevice';

// Default Media Receiver app ID (used by most Cast senders)
const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';

/**
 * Virtual Google Cast device.
 * Advertises via mDNS, accepts Cast v2 protocol connections,
 * and emits media control events.
 */
class CastDevice extends EventEmitter {
  constructor(options) {
    super();
    this.speakerName = options.speakerName;
    this.speakerIp = options.speakerIp;
    this.port = options.port;
    this.deviceId = options.deviceId || uuidv4().replace(/-/g, '');
    this.certificate = options.certificate || null; // May be provided by DeviceRegistry
    // Include IP suffix to make mDNS service names unique when multiple
    // speakers share the same room name
    const ipSuffix = this.speakerIp.split('.').pop();
    this.friendlyName = `${this.speakerName} (Cast-${ipSuffix})`;

    this._server = null;
    this._bonjour = options.bonjour;
    this._mdnsService = null;
    this._sessions = new Map(); // clientId -> session state
    this._mediaRequestId = 0;
    this._sessionId = uuidv4();
    this._transportId = `transport-${this.deviceId.substring(0, 8)}`;
    this._appRunning = false;
    this._mediaStatus = null;
  }

  async start() {
    // Use provided certificate or generate a new self-signed one
    let pems;
    if (this.certificate) {
      pems = this.certificate;
      log.debug(COMPONENT, `[${this.friendlyName}] Using persisted certificate`);
    } else {
      const attrs = [{ name: 'commonName', value: this.friendlyName }];
      pems = selfsigned.generate(attrs, {
        keySize: 2048,
        days: 3650,
        algorithm: 'sha256',
      });
      log.debug(COMPONENT, `[${this.friendlyName}] Generated new certificate`);
    }

    // Create Cast protocol server
    this._server = new CastProtocolServer({
      key: pems.private,
      cert: pems.cert,
    });

    this._server.on('connect', (clientId) => this._onConnect(clientId));
    this._server.on('disconnect', (clientId) => this._onDisconnect(clientId));
    this._server.on('message', (msg) => this._onMessage(msg));
    this._server.on('error', (err) => {
      log.error(COMPONENT, `[${this.friendlyName}] Server error: ${err.message}`);
    });

    await this._server.listen(this.port);

    // Advertise via mDNS
    this._advertiseMdns();

    log.info(
      COMPONENT,
      `Virtual Cast device "${this.friendlyName}" started on port ${this.port}`
    );
  }

  stop() {
    if (this._mdnsService) {
      try {
        this._mdnsService.stop();
      } catch (_) {}
      this._mdnsService = null;
    }

    if (this._server) {
      this._server.close();
      this._server = null;
    }

    log.info(COMPONENT, `Virtual Cast device "${this.friendlyName}" stopped`);
  }

  _advertiseMdns() {
    const txtRecord = {
      id: this.deviceId,
      cd: this.deviceId.substring(0, 32),
      rm: '',
      ve: '05',
      md: 'SonosCast',
      ic: '/setup/icon.png',
      fn: this.friendlyName,
      ca: '4101',
      st: '0',
      bs: this.deviceId.substring(0, 12),
      nf: '1',
      rs: '',
    };

    this._mdnsService = this._bonjour.publish({
      name: this.friendlyName,
      type: 'googlecast',
      port: this.port,
      txt: txtRecord,
    });

    log.debug(
      COMPONENT,
      `mDNS advertised: ${this.friendlyName} (_googlecast._tcp, port ${this.port})`
    );
  }

  _onConnect(clientId) {
    log.debug(COMPONENT, `[${this.friendlyName}] Client connected: ${clientId}`);
    this._sessions.set(clientId, { connected: true, senderId: null });
  }

  _onDisconnect(clientId) {
    log.debug(COMPONENT, `[${this.friendlyName}] Client disconnected: ${clientId}`);
    this._sessions.delete(clientId);
  }

  _onMessage(msg) {
    const { clientId, sourceId, destinationId, namespace, data } = msg;

    switch (namespace) {
      case CASTV2_NS_CONNECTION:
        this._handleConnection(clientId, sourceId, data);
        break;
      case CASTV2_NS_HEARTBEAT:
        this._handleHeartbeat(clientId, sourceId, data);
        break;
      case CASTV2_NS_DEVICEAUTH:
        this._handleDeviceAuth(clientId, sourceId, data);
        break;
      case CASTV2_NS_RECEIVER:
        this._handleReceiver(clientId, sourceId, data);
        break;
      case CASTV2_NS_MEDIA:
        this._handleMedia(clientId, sourceId, destinationId, data);
        break;
      default:
        log.debug(COMPONENT, `[${this.friendlyName}] Unknown namespace: ${namespace}`);
    }
  }

  // --- Connection namespace ---
  _handleConnection(clientId, sourceId, data) {
    try {
      const payload = JSON.parse(data);
      log.debug(COMPONENT, `[${this.friendlyName}] Connection: ${payload.type} from ${sourceId}`);

      if (payload.type === 'CONNECT') {
        const session = this._sessions.get(clientId);
        if (session) {
          session.senderId = sourceId;
        }
      }
    } catch (err) {
      log.warning(COMPONENT, `Failed to parse connection message: ${err.message}`);
    }
  }

  // --- Heartbeat namespace ---
  _handleHeartbeat(clientId, sourceId, data) {
    try {
      const payload = JSON.parse(data);

      if (payload.type === 'PING') {
        this._server.send(
          clientId,
          'receiver-0',
          sourceId,
          CASTV2_NS_HEARTBEAT,
          JSON.stringify({ type: 'PONG' })
        );
      }
    } catch (err) {
      log.warning(COMPONENT, `Failed to parse heartbeat message: ${err.message}`);
    }
  }

  // --- Device Auth namespace ---
  _handleDeviceAuth(clientId, sourceId, data) {
    log.info(COMPONENT, `[${this.friendlyName}] Device auth challenge received from ${sourceId}`);

    // Use Shanocast authentication bypass with precomputed signatures
    // This exploits Chrome's enforce_nonce_checking=false vulnerability
    try {
      // Parse the auth challenge
      const challenge = deviceAuthType.decode(data);
      log.debug(COMPONENT, `[${this.friendlyName}] AuthChallenge received`);

      // Generate auth response with precomputed signature
      const authResponseBuffer = castAuth.handleAuthChallenge(challenge);
      
      if (authResponseBuffer) {
        this._server.send(
          clientId,
          'receiver-0',
          sourceId,
          CASTV2_NS_DEVICEAUTH,
          authResponseBuffer
        );
        log.info(COMPONENT, `[${this.friendlyName}] Auth response sent (Shanocast bypass)`);
      } else {
        // Fallback to error response if no valid signature available
        log.warn(COMPONENT, `[${this.friendlyName}] No valid signature, sending auth error`);
        const authError = deviceAuthType.create({
          error: { errorType: 0 }, // INTERNAL_ERROR
        });
        const encoded = deviceAuthType.encode(authError).finish();
        this._server.send(
          clientId,
          'receiver-0',
          sourceId,
          CASTV2_NS_DEVICEAUTH,
          encoded
        );
      }
    } catch (err) {
      log.error(COMPONENT, `[${this.friendlyName}] Auth handler failed: ${err.message}`);
      // Send error response
      try {
        const authError = deviceAuthType.create({
          error: { errorType: 0 },
        });
        const encoded = deviceAuthType.encode(authError).finish();
        this._server.send(
          clientId,
          'receiver-0',
          sourceId,
          CASTV2_NS_DEVICEAUTH,
          encoded
        );
      } catch (fallbackErr) {
        log.error(COMPONENT, `[${this.friendlyName}] Failed to send auth error: ${fallbackErr.message}`);
      }
    }
  }

  // --- Receiver namespace ---
  _handleReceiver(clientId, sourceId, data) {
    try {
      const payload = JSON.parse(data);
      log.debug(COMPONENT, `[${this.friendlyName}] Receiver: ${payload.type} from ${sourceId}`);

      switch (payload.type) {
        case 'GET_STATUS':
          this._sendReceiverStatus(clientId, sourceId, payload.requestId);
          break;

        case 'LAUNCH':
          this._handleLaunch(clientId, sourceId, payload);
          break;

        case 'STOP':
          this._handleStop(clientId, sourceId, payload);
          break;

        case 'SET_VOLUME':
          this._handleSetVolume(clientId, sourceId, payload);
          break;

        default:
          log.debug(
            COMPONENT,
            `[${this.friendlyName}] Unhandled receiver message: ${payload.type}`
          );
      }
    } catch (err) {
      log.warning(COMPONENT, `Failed to parse receiver message: ${err.message}`);
    }
  }

  _handleLaunch(clientId, sourceId, payload) {
    const appId = payload.appId;
    log.info(
      COMPONENT,
      `[${this.friendlyName}] Launch requested: ${appId} from ${sourceId}`
    );

    // Accept any app launch - we'll handle media for all of them
    this._appRunning = true;
    this._sessionId = uuidv4();
    this._mediaStatus = null;

    this._sendReceiverStatus(clientId, sourceId, payload.requestId);
  }

  _handleStop(clientId, sourceId, payload) {
    log.info(COMPONENT, `[${this.friendlyName}] Stop requested from ${sourceId}`);
    this._appRunning = false;
    this._mediaStatus = null;
    this.emit('stop', { speakerIp: this.speakerIp });
    this._sendReceiverStatus(clientId, sourceId, payload.requestId);
  }

  _handleSetVolume(clientId, sourceId, payload) {
    if (payload.volume) {
      log.debug(
        COMPONENT,
        `[${this.friendlyName}] Volume set: ${JSON.stringify(payload.volume)}`
      );
      this.emit('volume', {
        speakerIp: this.speakerIp,
        level: payload.volume.level,
        muted: payload.volume.muted,
      });
    }
    this._sendReceiverStatus(clientId, sourceId, payload.requestId);
  }

  _sendReceiverStatus(clientId, sourceId, requestId) {
    const status = {
      type: 'RECEIVER_STATUS',
      requestId: requestId || 0,
      status: {
        volume: {
          level: 1.0,
          muted: false,
          controlType: 'attenuation',
          stepInterval: 0.05,
        },
        applications: this._appRunning
          ? [
              {
                appId: DEFAULT_MEDIA_RECEIVER,
                displayName: 'Default Media Receiver',
                isIdleScreen: false,
                launchedFromCloud: false,
                namespaces: [{ name: CASTV2_NS_MEDIA }],
                sessionId: this._sessionId,
                statusText: 'Ready To Cast',
                transportId: this._transportId,
              },
            ]
          : [],
        isActiveInput: true,
        isStandBy: false,
      },
    };

    this._server.send(
      clientId,
      'receiver-0',
      sourceId,
      CASTV2_NS_RECEIVER,
      JSON.stringify(status)
    );
  }

  // --- Media namespace ---
  _handleMedia(clientId, sourceId, destinationId, data) {
    try {
      const payload = JSON.parse(data);
      log.debug(
        COMPONENT,
        `[${this.friendlyName}] Media: ${payload.type} from ${sourceId}`
      );

      switch (payload.type) {
        case 'LOAD':
          this._handleMediaLoad(clientId, sourceId, payload);
          break;

        case 'PLAY':
          this.emit('play', { speakerIp: this.speakerIp });
          this._sendMediaStatus(clientId, sourceId, payload.requestId, 'PLAYING');
          break;

        case 'PAUSE':
          this.emit('pause', { speakerIp: this.speakerIp });
          this._sendMediaStatus(clientId, sourceId, payload.requestId, 'PAUSED');
          break;

        case 'STOP':
          this.emit('stop', { speakerIp: this.speakerIp });
          this._sendMediaStatus(clientId, sourceId, payload.requestId, 'IDLE');
          break;

        case 'SEEK':
          this.emit('seek', {
            speakerIp: this.speakerIp,
            currentTime: payload.currentTime,
          });
          this._sendMediaStatus(clientId, sourceId, payload.requestId, 'PLAYING');
          break;

        case 'GET_STATUS':
          this._sendMediaStatus(
            clientId,
            sourceId,
            payload.requestId,
            this._mediaStatus ? this._mediaStatus.playerState : 'IDLE'
          );
          break;

        case 'SET_VOLUME':
          if (payload.volume) {
            this.emit('volume', {
              speakerIp: this.speakerIp,
              level: payload.volume.level,
              muted: payload.volume.muted,
            });
          }
          this._sendMediaStatus(clientId, sourceId, payload.requestId);
          break;

        default:
          log.debug(
            COMPONENT,
            `[${this.friendlyName}] Unhandled media message: ${payload.type}`
          );
      }
    } catch (err) {
      log.warning(COMPONENT, `Failed to parse media message: ${err.message}`);
    }
  }

  _handleMediaLoad(clientId, sourceId, payload) {
    const media = payload.media;
    if (!media || !media.contentId) {
      log.warning(COMPONENT, `[${this.friendlyName}] LOAD missing media.contentId`);
      return;
    }

    log.info(
      COMPONENT,
      `[${this.friendlyName}] Loading: ${media.contentId} (${media.contentType || 'unknown'})`
    );

    this._mediaStatus = {
      mediaSessionId: ++this._mediaRequestId,
      playerState: 'BUFFERING',
      media: {
        contentId: media.contentId,
        contentType: media.contentType || '',
        streamType: media.streamType || 'BUFFERED',
        metadata: media.metadata || {},
      },
      currentTime: payload.currentTime || 0,
      supportedMediaCommands: 274447, // play, pause, seek, volume, etc.
      volume: { level: 1.0, muted: false },
    };

    this.emit('load', {
      speakerIp: this.speakerIp,
      contentId: media.contentId,
      contentType: media.contentType || '',
      streamType: media.streamType || 'BUFFERED',
      metadata: media.metadata || {},
      autoplay: payload.autoplay !== false,
      currentTime: payload.currentTime || 0,
    });

    // Send BUFFERING, then PLAYING status
    this._sendMediaStatus(clientId, sourceId, payload.requestId, 'BUFFERING');

    setTimeout(() => {
      this._sendMediaStatus(clientId, sourceId, 0, 'PLAYING');
    }, 500);
  }

  _sendMediaStatus(clientId, sourceId, requestId, playerState) {
    const status = {
      type: 'MEDIA_STATUS',
      requestId: requestId || 0,
      status: [],
    };

    if (this._mediaStatus) {
      if (playerState) {
        this._mediaStatus.playerState = playerState;
      }
      status.status.push(this._mediaStatus);
    }

    this._server.send(
      clientId,
      this._transportId,
      sourceId,
      CASTV2_NS_MEDIA,
      JSON.stringify(status)
    );
  }
}

module.exports = CastDevice;
