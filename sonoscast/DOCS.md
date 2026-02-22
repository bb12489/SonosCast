# SonosCast - Google Cast Bridge for Sonos

SonosCast discovers Sonos speakers on your network and creates virtual
Google Cast devices for each one. This allows you to cast audio from
Cast-compatible applications directly to your Sonos speakers.

## How it works

1. **Sonos Discovery**: The addon scans your network for Sonos speakers
   using SSDP/UPnP discovery.
2. **Virtual Cast Devices**: For each Sonos speaker found, a virtual
   Google Cast device is advertised on the network via mDNS.
3. **Protocol Bridge**: When a Cast sender connects to a virtual device,
   the addon translates Cast protocol commands (play, pause, stop,
   volume, seek) into Sonos-compatible UPnP commands.
4. **Media Forwarding**: Media URLs received via the Cast protocol are
   forwarded to the corresponding Sonos speaker for playback.

## Configuration

### Option: `log_level`

The `log_level` option controls the level of log output by the addon.

Possible values are:

- `trace`: Show every detail, including protocol-level messages.
- `debug`: Shows detailed debug information.
- `info`: Normal (usually sufficient) log level.
- `notice`: Normal but significant conditions.
- `warning`: Exceptional occurrences that are not errors.
- `error`: Runtime errors that do not require immediate action.
- `fatal`: Something went terribly wrong. The addon stops.

### Option: `base_port`

The starting port number for virtual Cast device servers. Each discovered
Sonos speaker gets a sequential port starting from this value.

Default: `8009` (the standard Google Cast port).

For example, if you have 3 Sonos speakers:
- Speaker 1: port 8009
- Speaker 2: port 8010
- Speaker 3: port 8011

### Option: `latency`

Audio latency compensation in milliseconds. Increase this value if you
experience audio sync issues. Set to `0` to disable.

Default: `0`

### Option: `excluded_speakers`

A list of Sonos speaker names to exclude from the Cast bridge. Speaker
names are case-insensitive.

Example:
```yaml
excluded_speakers:
  - "Bathroom"
  - "Garage"
```

## Network Requirements

This addon requires **host networking** to function properly. This is
enabled by default and is necessary for:

- mDNS multicast for Cast device advertisement
- SSDP multicast for Sonos speaker discovery
- Direct TLS connections from Cast senders

Ensure that your Home Assistant host is on the same network/VLAN as
both your Cast sender devices and Sonos speakers.

## Known Limitations

### Google Cast Device Authentication

Google's Cast SDK v2 includes a device authentication mechanism where
sender applications verify the receiver's identity using Google-signed
device certificates. Since SonosCast creates virtual (non-Google) Cast
devices, **official Cast SDK senders may reject the connection** after
the authentication check fails.

This means:

- **Chrome browser tab casting**: May not work (Chrome enforces device auth)
- **YouTube app**: May not work (uses official Cast SDK)
- **Official Google apps**: May not work (enforce device auth)
- **Third-party Cast apps**: May work if they don't enforce device auth
- **Custom Cast senders**: Will work (can skip device auth)
- **Home Assistant Cast integration**: Can work with direct media URLs

### Supported Audio Formats

Sonos speakers support playback of HTTP/HTTPS URLs serving these formats:

- MP3
- AAC
- FLAC
- WAV/PCM
- OGG Vorbis

Streaming protocols like HLS or DASH are not directly supported by Sonos
and would require transcoding (not currently implemented).

## Troubleshooting

### Speakers not discovered

- Ensure your Home Assistant host is on the same network as your
  Sonos speakers
- Check that multicast traffic is allowed on your network
- Try restarting the addon

### Cast devices not visible

- Ensure multicast DNS (mDNS) is allowed on your network
- Check that the configured ports are not blocked by a firewall
- Look at the addon logs with `log_level: debug`

### Audio not playing

- Verify the media URL is directly accessible from the Sonos speaker
- Sonos requires the audio URL to be reachable from the speaker itself
- Check that the audio format is supported by Sonos
