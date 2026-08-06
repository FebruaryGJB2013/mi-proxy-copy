# mi-wisp/
## PLEASE DONT USE this

### Instead use [The Updated and Safe version of mi-wispa](https://git.welltypers.it.com/Miguelqwe170/mi-wispa)

#### This version is only meant for the PROXY and not meant for real wisp clients(most of them)


A from-scratch [Wisp protocol](https://github.com/MercuryWorkshop/wisp-protocol)
server, replacing the `@mercuryworkshop/wisp-js` dependency `src/index.js`
used to mount at `/wisp/`. Built specifically for mi-proxy: no extra
dependency, smaller surface area, and nothing to configure beyond what
`src/index.js` already exposes via `WISP_*` env vars.

Speaks both protocol versions and picks per-connection based on the
[spec's rule](https://github.com/MercuryWorkshop/wisp-protocol/blob/v2/protocol.md#establishing-a-websocket-connection):
v2 if the upgrade request carries a `Sec-WebSocket-Protocol` header, v1
otherwise. Every Wisp client in the mi-proxy stack today (libcurl-transport,
epoxy-transport) speaks v1, so that's the path that matters in practice —
v2 support is there for forward compatibility and is exercised by the
handshake/extension-negotiation logic in `connection.js`.

## Files

| File            | Responsibility                                                          |
| ---------------- | ------------------------------------------------------------------------ |
| `index.js`       | `WispServer` — options object, `routeRequest(req, socket, head)`, wraps a `ws.WebSocketServer` in `noServer` mode |
| `connection.js`  | Per-WebSocket `WispConnection` — v1/v2 handshake, packet dispatch, stream table |
| `stream.js`      | Per-stream `Stream` — TCP (`net`) / UDP (`dgram`) socket, buffering, flow control |
| `packet.js`      | Encode/decode for every packet type (CONNECT, DATA, CONTINUE, CLOSE, INFO) |
| `dns.js`         | Resolves hostnames through `dns_servers` when configured (falls back to the OS resolver otherwise) |
| `constants.js`   | Packet types, stream types, close reasons, extension IDs                |
| `standalone.js`  | Runs this Wisp server on its own, with no proxy/frontend attached — see below |

## Running it standalone

`index.js` only exports the pieces (`server`, `logging`) meant to be wired
into an existing HTTP server, the way `src/index.js` does for the rest of
mi-proxy. `standalone.js` is a separate, minimal entry point that runs
*just* the Wisp server on its own port, with no Fastify, no static
frontend, nothing else:

```sh
npm run wisp
# or, for auto-restart on file changes:
npm run wisp:dev
```

It listens on `WISP_PORT` (default `8081`) and reads the same
`WISP_ALLOW_UDP` / `WISP_HOSTNAME_BLACKLIST` / `WISP_DNS_SERVERS` /
`WISP_LOG_LEVEL` variables from `.env` that the main app does. Any Wisp
client can point at `ws://host:8081/` directly — the path doesn't matter to
this server, it accepts any upgrade request.

This is useful for running the tunnel as its own service (e.g. behind a
different domain/port than the proxy frontend, or shared by multiple
frontends), or for testing/developing the Wisp implementation in isolation
without the rest of mi-proxy in the way.

## What's implemented

- Packet types: CONNECT, DATA, CONTINUE, CLOSE, INFO (v2 handshake)
- v1 (immediate `CONTINUE(0)`) and v2 (`INFO` ↔ `INFO` ↔ `CONTINUE(0)`) handshakes
- TCP and UDP streams, gated by `options.allow_udp_streams`
- Flow control: per-stream `CONTINUE` credit on the client→server direction; server→client backpressure via pausing the source socket until the outgoing `ws.send()` callback fires
- Buffering of `DATA` packets that arrive for a stream before its underlying
  socket exists yet (explicitly allowed by the spec — clients are meant to
  send optimistically without waiting for a connection to be confirmed)
- Hostname blacklist (`options.hostname_blacklist`, an array of `RegExp`) → `CLOSE(0x48)`
- Configurable DNS resolvers (`options.dns_servers`)
- Close reasons: `UNREACHABLE`, `TIMEOUT`, `REFUSED`, `BLOCKED`, `INVALID_INFO`, `VOLUNTARY`, `NETWORK_ERROR`
- v2 extensions: UDP presence, Stream Open Confirmation (server sends a
  per-stream `CONTINUE` once the destination socket actually connects, if
  both sides negotiated it)

## Not implemented

- v2 password/key authentication and MOTD extensions — not needed for
  mi-proxy's same-origin, no-public-wisp-domain design (see the main
  README's "How 'no public domain' works" section), so left out rather than
  built and unused. Would be straightforward to add in `connection.js`
  following the same extension-negotiation pattern as Stream Open
  Confirmation, if a use case shows up (e.g. gating a public deployment).

## Testing notes

There's no automated test suite checked in yet. This was validated with:

- A raw WebSocket client script driving the packet protocol directly
  (handshake, CONNECT/DATA/CLOSE, v1 and v2) against a local TCP echo server
- The same against a local UDP echo server
- Hostname blacklist and connection-refused paths, checking the specific
  `CLOSE` reason codes
- The real client stack end-to-end: a headless browser running the actual
  Scramjet + libcurl-transport frontend code, unmodified, proxying to a
  local HTTP origin server through this Wisp server and rendering the
  response inside the proxied iframe
