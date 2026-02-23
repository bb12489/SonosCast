'use strict';

const os = require('os');
const Bonjour = require('bonjour-service').Bonjour;
const SonosManager = require('./sonos-manager');
const CastDevice = require('./cast-device');
const DeviceRegistry = require('./device-registry');
const log = require('./logger');

const COMPONENT = 'Bridge';

/**
 * Get the local network IP address (not Tailscale or loopback).
 * Prioritizes 192.168.x.x and 10.x.x.x private networks.
 */
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    // Skip Tailscale, loopback, and virtual interfaces
    if (name.includes('tailscale') || name.includes('docker') || 
        name.includes('veth') || name.includes('lo')) {
      continue;
    }
    
    for (const iface of interfaces[name]) {
      // Skip IPv6, loopback, and Tailscale ranges (100.x.x.x)
      if (iface.family === 'IPv4' && !iface.internal && 
          !iface.address.startsWith('100.')) {
        log.debug(COMPONENT, `Detected local network IP: ${iface.address} on ${name}`);
        return iface.address;
      }
    }
  }
  
  log.warning(COMPONENT, 'Could not detect local network IP, using default');
  return null;
}

/**
 * Orchestrates the Cast-to-Sonos bridge.
 * Creates virtual Cast devices for each discovered Sonos speaker
 * and forwards media commands.
 */
class Bridge {
  constructor(config) {
    this.config = config;
    this._sonosManager = new SonosManager(config.excludedSpeakers);
    
    // Get local network IP to avoid advertising on Tailscale
    this._localIP = getLocalNetworkIP();
    if (this._localIP) {
      log.info(COMPONENT, `Binding mDNS to local network: ${this._localIP}`);
      this._bonjour = new Bonjour({ interface: this._localIP });
    } else {
      this._bonjour = new Bonjour();
    }
    
    this._deviceRegistry = new DeviceRegistry();
    this._castDevices = new Map(); // speakerIp -> CastDevice
    this._nextPort = config.basePort;
  }

  async start() {
    log.info(COMPONENT, 'Starting SonosCast bridge...');

    this._sonosManager.on('speaker-found', (speaker) => {
      this._addCastDevice(speaker);
    });

    this._sonosManager.on('speaker-lost', (speaker) => {
      this._removeCastDevice(speaker);
    });

    await this._sonosManager.start();
    log.info(COMPONENT, 'SonosCast bridge is running');
  }

  async stop() {
    log.info(COMPONENT, 'Stopping SonosCast bridge...');

    this._sonosManager.stop();

    for (const [ip, castDevice] of this._castDevices) {
      castDevice.stop();
    }
    this._castDevices.clear();

    this._bonjour.destroy();
    log.info(COMPONENT, 'SonosCast bridge stopped');
  }

  async _addCastDevice(speaker) {
    if (this._castDevices.has(speaker.ip)) {
      return;
    }

    const port = this._nextPort++;
    
    // Generate IP-based suffix for unique mDNS names
    const ipSuffix = speaker.ip.split('.').pop();
    const friendlyName = `${speaker.name} (Cast-${ipSuffix})`;
    
    // Get or create persistent device identity
    const identity = this._deviceRegistry.getOrCreateDevice(speaker.ip, friendlyName);
    
    const castDevice = new CastDevice({
      speakerName: speaker.name,
      speakerIp: speaker.ip,
      port,
      bonjour: this._bonjour,
      deviceId: identity.deviceId,
      certificate: identity.certificate,
      localIP: this._localIP,
    });

    // Wire up media events to Sonos actions
    castDevice.on('load', (evt) => this._onLoad(speaker, evt));
    castDevice.on('play', (evt) => this._onPlay(speaker, evt));
    castDevice.on('pause', (evt) => this._onPause(speaker, evt));
    castDevice.on('stop', (evt) => this._onStop(speaker, evt));
    castDevice.on('seek', (evt) => this._onSeek(speaker, evt));
    castDevice.on('volume', (evt) => this._onVolume(speaker, evt));

    try {
      await castDevice.start();
      this._castDevices.set(speaker.ip, castDevice);
      log.info(
        COMPONENT,
        `Cast bridge active: "${speaker.name}" -> port ${port}`
      );
    } catch (err) {
      log.error(
        COMPONENT,
        `Failed to create Cast device for "${speaker.name}": ${err.message}`
      );
    }
  }

  _removeCastDevice(speaker) {
    const castDevice = this._castDevices.get(speaker.ip);
    if (castDevice) {
      castDevice.stop();
      this._castDevices.delete(speaker.ip);
      log.info(COMPONENT, `Cast bridge removed: "${speaker.name}"`);
    }
  }

  // --- Media event handlers ---

  async _onLoad(speaker, evt) {
    log.info(
      COMPONENT,
      `[${speaker.name}] Loading media: ${evt.contentId}`
    );
    try {
      // Use the AVTransport SOAP service directly to pass DIDL-Lite metadata
      // which gives Sonos proper track info display
      const metadata = this._buildDIDL(evt);
      await speaker.device.setAVTransportURI({
        uri: evt.contentId,
        metadata,
        onlySetUri: !evt.autoplay,
      });

      log.info(COMPONENT, `[${speaker.name}] Playback started`);
    } catch (primaryErr) {
      // Fallback: use simpler play(uri) which handles most HTTP URLs
      log.debug(
        COMPONENT,
        `[${speaker.name}] setAVTransportURI failed, trying play(): ${primaryErr.message}`
      );
      try {
        if (evt.autoplay) {
          await speaker.device.play(evt.contentId);
        }
        log.info(COMPONENT, `[${speaker.name}] Playback started (fallback)`);
      } catch (fallbackErr) {
        log.error(
          COMPONENT,
          `[${speaker.name}] Failed to load media: ${fallbackErr.message}`
        );
      }
    }
  }

  async _onPlay(speaker) {
    log.debug(COMPONENT, `[${speaker.name}] Play`);
    try {
      await speaker.device.play();
    } catch (err) {
      log.error(COMPONENT, `[${speaker.name}] Play failed: ${err.message}`);
    }
  }

  async _onPause(speaker) {
    log.debug(COMPONENT, `[${speaker.name}] Pause`);
    try {
      await speaker.device.pause();
    } catch (err) {
      log.error(COMPONENT, `[${speaker.name}] Pause failed: ${err.message}`);
    }
  }

  async _onStop(speaker) {
    log.debug(COMPONENT, `[${speaker.name}] Stop`);
    try {
      await speaker.device.stop();
    } catch (err) {
      log.error(COMPONENT, `[${speaker.name}] Stop failed: ${err.message}`);
    }
  }

  async _onSeek(speaker, evt) {
    log.debug(COMPONENT, `[${speaker.name}] Seek to ${evt.currentTime}s`);
    try {
      const hours = Math.floor(evt.currentTime / 3600);
      const minutes = Math.floor((evt.currentTime % 3600) / 60);
      const seconds = Math.floor(evt.currentTime % 60);
      const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      await speaker.device.seek(timeStr);
    } catch (err) {
      log.error(COMPONENT, `[${speaker.name}] Seek failed: ${err.message}`);
    }
  }

  async _onVolume(speaker, evt) {
    log.debug(
      COMPONENT,
      `[${speaker.name}] Volume: level=${evt.level}, muted=${evt.muted}`
    );
    try {
      if (evt.level !== undefined && evt.level !== null) {
        // Sonos volume is 0-100, Cast volume is 0.0-1.0
        const sonosVolume = Math.round(evt.level * 100);
        await speaker.device.setVolume(sonosVolume);
      }
      if (evt.muted !== undefined && evt.muted !== null) {
        await speaker.device.setMuted(evt.muted);
      }
    } catch (err) {
      log.error(COMPONENT, `[${speaker.name}] Volume failed: ${err.message}`);
    }
  }

  /**
   * Build a minimal DIDL-Lite metadata string for Sonos.
   * Sonos uses UPnP AV for transport, which expects DIDL-Lite XML.
   */
  _buildDIDL(evt) {
    const title = (evt.metadata && evt.metadata.title) || 'Cast Audio';
    const contentType = evt.contentType || 'audio/mpeg';

    // Determine the UPnP class based on stream type
    const upnpClass =
      evt.streamType === 'LIVE'
        ? 'object.item.audioItem.audioBroadcast'
        : 'object.item.audioItem.musicTrack';

    return [
      '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"',
      ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
      ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">',
      '<item>',
      `<dc:title>${this._escapeXml(title)}</dc:title>`,
      `<upnp:class>${upnpClass}</upnp:class>`,
      `<res protocolInfo="http-get:*:${contentType}:*">${this._escapeXml(evt.contentId)}</res>`,
      '</item>',
      '</DIDL-Lite>',
    ].join('');
  }

  _escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = Bridge;
