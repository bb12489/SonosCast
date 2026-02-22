'use strict';

const tls = require('tls');
const EventEmitter = require('events');
const protobuf = require('protobufjs');
const log = require('./logger');

const COMPONENT = 'CastProtocol';

// Cast v2 protocol constants
const CASTV2_NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection';
const CASTV2_NS_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat';
const CASTV2_NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver';
const CASTV2_NS_MEDIA = 'urn:x-cast:com.google.cast.media';
const CASTV2_NS_DEVICEAUTH = 'urn:x-cast:com.google.cast.tp.deviceauth';

// Define CastMessage protobuf schema
const castMessageType = protobuf.Root.fromJSON({
  nested: {
    CastMessage: {
      fields: {
        protocolVersion: { type: 'ProtocolVersion', id: 1 },
        sourceId: { type: 'string', id: 2 },
        destinationId: { type: 'string', id: 3 },
        namespace_: { type: 'string', id: 4 },
        payloadType: { type: 'PayloadType', id: 5 },
        payloadUtf8: { type: 'string', id: 6 },
        payloadBinary: { type: 'bytes', id: 7 },
      },
      nested: {
        ProtocolVersion: { values: { CASTV2_1_0: 0 } },
        PayloadType: { values: { STRING: 0, BINARY: 1 } },
      },
    },
  },
}).lookupType('CastMessage');

// Define DeviceAuthMessage protobuf schema
const deviceAuthType = protobuf.Root.fromJSON({
  nested: {
    DeviceAuthMessage: {
      fields: {
        challenge: { type: 'AuthChallenge', id: 1 },
        response: { type: 'AuthResponse', id: 2 },
        error: { type: 'AuthError', id: 3 },
      },
    },
    AuthChallenge: { fields: {} },
    AuthResponse: {
      fields: {
        signature: { type: 'bytes', id: 1 },
        clientAuthCertificate: { type: 'bytes', id: 2 },
        intermediateCertificate: { type: 'bytes', id: 3, rule: 'repeated' },
      },
    },
    AuthError: {
      fields: {
        errorType: { type: 'ErrorType', id: 1 },
      },
      nested: {
        ErrorType: {
          values: { INTERNAL_ERROR: 0, NO_TLS: 1 },
        },
      },
    },
  },
}).lookupType('DeviceAuthMessage');

/**
 * Reads length-prefixed protobuf messages from a TLS socket.
 * Protocol: 4-byte big-endian length prefix followed by protobuf data.
 */
class PacketReader {
  constructor(socket, onMessage) {
    this._socket = socket;
    this._onMessage = onMessage;
    this._buffer = Buffer.alloc(0);
    this._expectedLength = null;

    socket.on('data', (chunk) => this._onData(chunk));
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (true) {
      if (this._expectedLength === null) {
        if (this._buffer.length < 4) break;
        this._expectedLength = this._buffer.readUInt32BE(0);
        this._buffer = this._buffer.slice(4);
      }

      if (this._buffer.length < this._expectedLength) {
        break; // Wait for more data
      }

      const messageData = this._buffer.slice(0, this._expectedLength);
      this._buffer = this._buffer.slice(this._expectedLength);
      this._expectedLength = null;

      try {
        const message = castMessageType.decode(messageData);
        this._onMessage(message);
      } catch (err) {
        log.warning(COMPONENT, `Failed to decode message: ${err.message}`);
      }
    }
  }
}

/**
 * Low-level Cast v2 protocol server.
 * Creates a TLS server that speaks the Cast v2 framed protobuf protocol.
 */
class CastProtocolServer extends EventEmitter {
  constructor(tlsOptions) {
    super();
    this._tlsOptions = Object.assign(
      { rejectUnauthorized: false },
      tlsOptions
    );
    this._server = null;
    this._clients = new Map(); // clientId -> { socket, reader }
    this._clientCounter = 0;
  }

  listen(port, host) {
    return new Promise((resolve, reject) => {
      this._server = tls.createServer(this._tlsOptions, (socket) => {
        this._onConnection(socket);
      });

      this._server.on('error', (err) => {
        log.error(COMPONENT, `Server error on port ${port}: ${err.message}`);
        this.emit('error', err);
      });

      this._server.listen(port, host, () => {
        log.debug(COMPONENT, `Cast server listening on ${host || '0.0.0.0'}:${port}`);
        resolve();
      });
    });
  }

  send(clientId, sourceId, destinationId, namespace, data) {
    const client = this._clients.get(clientId);
    if (!client) {
      log.warning(COMPONENT, `Cannot send to unknown client: ${clientId}`);
      return;
    }

    const isBinary = Buffer.isBuffer(data);
    const message = {
      protocolVersion: 0, // CASTV2_1_0
      sourceId,
      destinationId,
      namespace_: namespace,
      payloadType: isBinary ? 1 : 0,
    };

    if (isBinary) {
      message.payloadBinary = data;
    } else {
      message.payloadUtf8 = typeof data === 'string' ? data : JSON.stringify(data);
    }

    const errMsg = castMessageType.verify(message);
    if (errMsg) {
      log.error(COMPONENT, `Invalid message: ${errMsg}`);
      return;
    }

    const encoded = castMessageType.encode(castMessageType.create(message)).finish();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(encoded.length, 0);

    try {
      client.socket.write(Buffer.concat([header, encoded]));
    } catch (err) {
      log.warning(COMPONENT, `Failed to send to ${clientId}: ${err.message}`);
    }
  }

  close() {
    for (const [clientId, client] of this._clients) {
      try {
        client.socket.destroy();
      } catch (_) {}
    }
    this._clients.clear();

    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }

  _onConnection(socket) {
    const clientId = `client-${++this._clientCounter}`;
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    log.info(COMPONENT, `New connection from ${addr} (${clientId})`);

    const reader = new PacketReader(socket, (message) => {
      const namespace = message.namespace_;
      const data =
        message.payloadType === 1
          ? message.payloadBinary
          : message.payloadUtf8;

      log.trace(
        COMPONENT,
        `[${clientId}] ${message.sourceId} -> ${message.destinationId} [${namespace}]`
      );

      this.emit('message', {
        clientId,
        sourceId: message.sourceId,
        destinationId: message.destinationId,
        namespace,
        data,
      });
    });

    this._clients.set(clientId, { socket, reader });

    socket.on('error', (err) => {
      log.debug(COMPONENT, `Socket error for ${clientId}: ${err.message}`);
    });

    socket.on('close', () => {
      log.info(COMPONENT, `Connection closed: ${clientId} (${addr})`);
      this._clients.delete(clientId);
      this.emit('disconnect', clientId);
    });

    this.emit('connect', clientId);
  }
}

module.exports = {
  CastProtocolServer,
  castMessageType,
  deviceAuthType,
  CASTV2_NS_CONNECTION,
  CASTV2_NS_HEARTBEAT,
  CASTV2_NS_RECEIVER,
  CASTV2_NS_MEDIA,
  CASTV2_NS_DEVICEAUTH,
};
