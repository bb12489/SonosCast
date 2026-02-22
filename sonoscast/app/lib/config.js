'use strict';

const fs = require('fs');
const path = require('path');

const OPTIONS_PATH = '/data/options.json';

const LOG_LEVELS = ['trace', 'debug', 'info', 'notice', 'warning', 'error', 'fatal'];
const LOG_LEVEL_PRIORITY = {
  trace: 0,
  debug: 1,
  info: 2,
  notice: 3,
  warning: 4,
  error: 5,
  fatal: 6,
};

function load() {
  let options = {};

  try {
    if (fs.existsSync(OPTIONS_PATH)) {
      options = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
    }
  } catch (err) {
    // Fall back to defaults if options file is missing or invalid
  }

  return {
    logLevel: options.log_level || 'info',
    basePort: options.base_port || 8009,
    latency: options.latency || 0,
    excludedSpeakers: options.excluded_speakers || [],
  };
}

module.exports = { load, LOG_LEVELS, LOG_LEVEL_PRIORITY };
