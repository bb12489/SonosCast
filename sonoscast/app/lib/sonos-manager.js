'use strict';

const { DeviceDiscovery, Sonos } = require('sonos');
const EventEmitter = require('events');
const log = require('./logger');

const COMPONENT = 'SonosManager';
const REDISCOVERY_INTERVAL = 60000; // Re-scan every 60 seconds
const DISCOVERY_TIMEOUT = 10000;    // Wait 10 seconds per scan

class SonosManager extends EventEmitter {
  constructor(excludedSpeakers) {
    super();
    this.excludedSpeakers = (excludedSpeakers || []).map(s => s.toLowerCase());
    this.speakers = new Map(); // ip -> { device, name, uuid, model }
    this._discoveryTimer = null;
    this._running = false;
  }

  async start() {
    this._running = true;
    log.info(COMPONENT, 'Starting Sonos speaker discovery...');
    await this._discover();
    this._discoveryTimer = setInterval(() => this._discover(), REDISCOVERY_INTERVAL);
  }

  stop() {
    this._running = false;
    if (this._discoveryTimer) {
      clearInterval(this._discoveryTimer);
      this._discoveryTimer = null;
    }
    log.info(COMPONENT, 'Sonos discovery stopped');
  }

  getSpeakers() {
    return Array.from(this.speakers.values());
  }

  getSpeakerByIp(ip) {
    return this.speakers.get(ip);
  }

  async _discover() {
    if (!this._running) return;

    log.debug(COMPONENT, 'Scanning for Sonos speakers...');

    return new Promise((resolve) => {
      const found = new Set();

      const discovery = DeviceDiscovery({ timeout: DISCOVERY_TIMEOUT }, async (device) => {
        const ip = device.host;
        found.add(ip);

        if (this.speakers.has(ip)) {
          log.trace(COMPONENT, `Already known: ${ip}`);
          return;
        }

        try {
          const sonosDevice = new Sonos(ip, device.port);
          const desc = await sonosDevice.deviceDescription();

          const name = desc.roomName || desc.friendlyName || ip;
          const uuid = desc.UDN ? desc.UDN.replace('uuid:', '') : ip;
          const model = desc.modelName || 'Sonos';

          if (this.excludedSpeakers.includes(name.toLowerCase())) {
            log.info(COMPONENT, `Excluding speaker: ${name} (${ip})`);
            return;
          }

          const speaker = { device: sonosDevice, ip, name, uuid, model };
          this.speakers.set(ip, speaker);

          log.info(COMPONENT, `Discovered: ${name} (${model}) at ${ip}`);
          this.emit('speaker-found', speaker);
        } catch (err) {
          log.warning(COMPONENT, `Failed to get details for ${ip}: ${err.message}`);
        }
      });

      // After discovery timeout, check for removed speakers
      setTimeout(() => {
        if (!this._running) return;

        for (const [ip, speaker] of this.speakers) {
          if (!found.has(ip)) {
            log.info(COMPONENT, `Speaker gone: ${speaker.name} (${ip})`);
            this.speakers.delete(ip);
            this.emit('speaker-lost', speaker);
          }
        }

        const count = this.speakers.size;
        log.debug(COMPONENT, `Discovery complete. ${count} speaker(s) found.`);
        resolve();
      }, DISCOVERY_TIMEOUT + 1000);
    });
  }
}

module.exports = SonosManager;
