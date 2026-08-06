# wisp/ (planned)

This folder is reserved for a from-scratch Wisp server implementation to
replace the current `@mercuryworkshop/wisp-js` dependency in `src/index.js`.
Not implemented yet — this is a placeholder for that work.

## Why

`wisp-js` works, but it's a general-purpose reference implementation. The
goal here is a Wisp server built specifically for mi-proxy: smaller, faster,
and with less to configure, while staying wire-compatible with the
[Wisp protocol](https://github.com/MercuryWorkshop/wisp-protocol) so it drops
in wherever `wisp-js` is used today (`src/index.js`'s `/wisp/` mount, and any
client that speaks Wisp — Scramjet, libcurl-transport, epoxy-transport, etc.).

## Target: Wisp v2

Spec: https://github.com/MercuryWorkshop/wisp-protocol/blob/v2/protocol.md

v2 adds a handshake (`INFO` packets exchanged before anything else) on top
of v1's packet types, which is what makes the optional features below
possible. A v2 server must still speak v1 to clients that don't send
`Sec-WebSocket-Protocol` on the upgrade request.

Packet types (same numbering in both versions):

| Type | Name     | Purpose                                    |
| ---- | -------- | ------------------------------------------- |
| 0x01 | CONNECT  | Client opens a new TCP/UDP stream           |
| 0x02 | DATA     | Payload for an open stream                  |
| 0x03 | CONTINUE | Flow control / buffer credit                |
| 0x04 | CLOSE    | Close a stream, with a reason code          |
| 0x05 | INFO     | v2 only — handshake: versions + extensions  |

v2 extensions worth targeting, roughly in priority order:

1. **UDP (`0x01`)** — already required for parity with the current setup
   (`WISP_ALLOW_UDP`).
2. **Stream Open Confirmation (`0x05`)** — lets the client know a CONNECT
   actually succeeded before it starts sending data.
3. **Server MOTD (`0x04`)** — surfaced through `/api/config` or similar for
   the frontend to show.
4. **Password / key auth (`0x02`/`0x03`)** — only useful once mi-proxy wants
   to gate its tunnel; not needed for the current same-origin, no-public-wisp-domain
   design, so lowest priority.

## Suggested shape

```
wisp/
  server.js       Wisp v1 + v2 packet framing, CONNECT/DATA/CONTINUE/CLOSE handling
  handshake.js    v2 INFO exchange, extension negotiation
  extensions/
    udp.js
    motd.js
  index.js        exports whatever src/index.js mounts at /wisp/
```

`src/index.js` would swap its
`import { server as wisp } from "@mercuryworkshop/wisp-js/server"` for
whatever this module ends up exporting, keeping the same `wisp.routeRequest(req, socket, head)`
call shape so the rest of the server doesn't need to change.

## Status

Not started. Ping to kick off an implementation pass.
