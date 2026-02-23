'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const selfsigned = require('selfsigned');
const log = require('./logger');

const COMPONENT = 'DeviceRegistry';
const REGISTRY_PATH = '/data/cast-device-registry.json';

/**
 * Manages persistent device identities (IDs and TLS certificates)
 * so virtual Cast devices maintain stable identities across restarts.
 */
class DeviceRegistry {
  constructor() {
    this._registry = this._load();
  }

  /**
   * Get or create a device identity for a given speaker
   * @param {string} speakerIp - IP address of the Sonos speaker
   * @param {string} friendlyName - Friendly name for the virtual device
   * @returns {{deviceId: string, certificate: {key: string, cert: string}}}
   */
  getOrCreateDevice(speakerIp, friendlyName) {
    if (!this._registry[speakerIp]) {
      log.info(COMPONENT, `Creating new device identity for ${speakerIp}`);
      
      const deviceId = uuidv4().replace(/-/g, '');
      const attrs = [{ name: 'commonName', value: friendlyName }];
      const pems = selfsigned.generate(attrs, {
        keySize: 2048,
        days: 3650,
        algorithm: 'sha256',
      });

      this._registry[speakerIp] = {
        deviceId,
        certificate: {
          key: pems.private,
          cert: pems.cert,
        },
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      };

      this._save();
    } else {
      // Update last seen timestamp
      this._registry[speakerIp].lastSeen = new Date().toISOString();
      this._save();
    }

    return {
      deviceId: this._registry[speakerIp].deviceId,
      certificate: this._registry[speakerIp].certificate,
    };
  }

  /**
   * Remove a device from the registry
   * @param {string} speakerIp - IP address of the Sonos speaker
   */
  removeDevice(speakerIp) {
    if (this._registry[speakerIp]) {
      delete this._registry[speakerIp];
      this._save();
      log.info(COMPONENT, `Removed device identity for ${speakerIp}`);
    }
  }

  /**
   * Load the registry from disk
   */
  _load() {
    try {
      if (fs.existsSync(REGISTRY_PATH)) {
        const data = fs.readFileSync(REGISTRY_PATH, 'utf8');
        const registry = JSON.parse(data);
        log.info(COMPONENT, `Loaded ${Object.keys(registry).length} device(s) from registry`);
        return registry;
      }
    } catch (err) {
      log.warning(COMPONENT, `Failed to load device registry: ${err.message}`);
    }
    return {};
  }

  /**
   * Save the registry to disk
   */
  _save() {
    try {
      // Ensure /data directory exists
      const dir = path.dirname(REGISTRY_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(this._registry, null, 2), 'utf8');
      log.debug(COMPONENT, `Saved ${Object.keys(this._registry).length} device(s) to registry`);
    } catch (err) {
      log.error(COMPONENT, `Failed to save device registry: ${err.message}`);
    }
  }

  /**
   * Get all registered devices
   */
  getAllDevices() {
    return Object.keys(this._registry);
  }

  /**
   * Clear the entire registry (useful for troubleshooting)
   */
  clear() {
    this._registry = {};
    this._save();
    log.warning(COMPONENT, 'Device registry cleared');
  }
}

module.exports = DeviceRegistry;
