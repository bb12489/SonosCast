# SonosCast

Google Cast capabilities for your Sonos speakers, packaged as a
Home Assistant add-on.

## About

SonosCast discovers Sonos players on your network and creates virtual
Google Cast devices for each one. It acts as a bridge between Google
Cast sender applications and your Sonos speakers, similar to how
[AirSonos](https://github.com/hassio-addons/addon-airsonos) bridges
AirPlay to Sonos.

### How it works

```
Cast Sender App ──Cast v2──> SonosCast Bridge ──UPnP──> Sonos Speaker
     (phone/browser)          (virtual device)           (actual speaker)
```

1. Discovers Sonos speakers via SSDP/UPnP
2. Creates a virtual Google Cast device per speaker (mDNS advertisement)
3. Accepts Cast v2 protocol connections over TLS
4. Translates Cast media commands to Sonos UPnP transport calls

### Features

- Automatic Sonos speaker discovery and re-scanning
- Virtual Cast device per speaker with individual mDNS entries
- Full Cast v2 protocol server (connection, heartbeat, receiver, media)
- Media URL forwarding with DIDL-Lite metadata
- Play, pause, stop, seek, and volume control
- Configurable speaker exclusion
- s6-overlay service management for reliable operation

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the SonosCast add-on
3. Configure options (base port, excluded speakers, etc.)
4. Start the add-on

## Supported Architectures

- `amd64`
- `aarch64`

## Known Limitations

Google's Cast SDK v2 uses device authentication with Google-signed
certificates. Since SonosCast creates virtual devices without these
certificates, official Cast SDK senders (Chrome, YouTube app, etc.)
may reject the connection after the auth challenge fails. Third-party
senders that skip device authentication will work.

See the [full documentation](sonoscast/DOCS.md) for details.

## License

MIT
