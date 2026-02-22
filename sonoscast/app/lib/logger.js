'use strict';

const { LOG_LEVEL_PRIORITY } = require('./config');

let currentLevel = 'info';

function setLevel(level) {
  currentLevel = level;
}

function shouldLog(level) {
  return (LOG_LEVEL_PRIORITY[level] || 0) >= (LOG_LEVEL_PRIORITY[currentLevel] || 0);
}

function formatMessage(level, component, message) {
  const timestamp = new Date().toISOString();
  const prefix = component ? `[${component}]` : '';
  return `${timestamp} ${level.toUpperCase().padEnd(7)} ${prefix} ${message}`;
}

function trace(component, message) {
  if (shouldLog('trace')) console.log(formatMessage('trace', component, message));
}

function debug(component, message) {
  if (shouldLog('debug')) console.log(formatMessage('debug', component, message));
}

function info(component, message) {
  if (shouldLog('info')) console.log(formatMessage('info', component, message));
}

function notice(component, message) {
  if (shouldLog('notice')) console.log(formatMessage('notice', component, message));
}

function warning(component, message) {
  if (shouldLog('warning')) console.warn(formatMessage('warning', component, message));
}

function error(component, message) {
  if (shouldLog('error')) console.error(formatMessage('error', component, message));
}

function fatal(component, message) {
  if (shouldLog('fatal')) console.error(formatMessage('fatal', component, message));
}

module.exports = { setLevel, trace, debug, info, notice, warning, error, fatal };
