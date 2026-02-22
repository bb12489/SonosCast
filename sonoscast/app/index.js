'use strict';

const config = require('./lib/config');
const log = require('./lib/logger');
const Bridge = require('./lib/bridge');

const COMPONENT = 'SonosCast';

async function main() {
  const cfg = config.load();
  log.setLevel(cfg.logLevel);

  log.info(COMPONENT, '-------------------------------------------');
  log.info(COMPONENT, 'SonosCast - Google Cast bridge for Sonos');
  log.info(COMPONENT, '-------------------------------------------');
  log.info(COMPONENT, `Log level: ${cfg.logLevel}`);
  log.info(COMPONENT, `Base port: ${cfg.basePort}`);
  log.info(COMPONENT, `Latency: ${cfg.latency}ms`);

  if (cfg.excludedSpeakers.length > 0) {
    log.info(
      COMPONENT,
      `Excluded speakers: ${cfg.excludedSpeakers.join(', ')}`
    );
  }

  const bridge = new Bridge(cfg);

  // Graceful shutdown
  const shutdown = async (signal) => {
    log.info(COMPONENT, `Received ${signal}, shutting down...`);
    try {
      await bridge.stop();
    } catch (err) {
      log.error(COMPONENT, `Shutdown error: ${err.message}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    log.fatal(COMPONENT, `Uncaught exception: ${err.message}`);
    log.fatal(COMPONENT, err.stack);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.fatal(COMPONENT, `Unhandled rejection: ${reason}`);
    process.exit(1);
  });

  try {
    await bridge.start();
  } catch (err) {
    log.fatal(COMPONENT, `Failed to start: ${err.message}`);
    process.exit(1);
  }
}

main();
