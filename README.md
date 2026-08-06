# mi-proxy

A self-hosted, single-origin web proxy. It bundles everything a proxy site
normally needs into one process:

- **[Scramjet](https://github.com/MercuryWorkshop/scramjet)** as the
  interception/rewriting engine (service-worker based, so it can proxy
  most modern sites including things like Google and YouTube).
- **Its own [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) server**,
  mounted at `/wisp/` on the exact same HTTP server as the site itself —
  there is no separate wisp provider to sign up for, configure, or point at
  a different domain. Whatever host you reach this app on (a real domain,
  a bare IP, `localhost:8080`, a `.onion`, anything) is automatically also
  the wisp endpoint, computed at request time from `Host`.
- A tiny **REST API** so other tools can discover how to talk to a running
  instance without hardcoding URLs.

## Quick start

```sh
git clone https://github.com/miguelqwe1701/mi-proxy.git
cd mi-proxy
npm install
npm start
```

Then open <http://localhost:8080>. That's it — no wisp server to deploy
separately, no extra ports to open, no config required to get started.

Copy `.env.example` to `.env` to change the port, default search engine, or
wisp server behavior (UDP, DNS resolvers, hostname blacklist).

### Docker

```sh
docker compose up -d
```

or without compose:

```sh
docker build -t mi-proxy .
docker run -p 8080:8080 mi-proxy
```

## How "no public domain" works

Most proxy setups need two things pointed at each other: the site itself,
and a wisp server that the site's client-side code is hardcoded to talk to
(often on its own subdomain). mi-proxy instead:

1. Runs the wisp server (`@mercuryworkshop/wisp-js`) inside the same Node
   process as the web server, handling the HTTP `upgrade` event on requests
   to `/wisp/` (see `src/index.js`).
2. Never hardcodes a wisp URL. The frontend asks `/api/config` for the
   wisp endpoint, which the server builds from the incoming request's own
   `Host` header (falling back to `location.host` client-side if the API
   call fails). So whatever address you're using to reach the proxy is the
   address the tunnel connects through too.

This means deploying mi-proxy anywhere that gives you a single reachable
address is enough — a VPS with just an IP, a `.local`/LAN hostname, a free
subdomain, whatever you've got.

## REST API

| Method | Path           | Description                                             |
| ------ | -------------- | -------------------------------------------------------- |
| GET    | `/api/health`  | Liveness check + process uptime.                          |
| GET    | `/api/config`  | Public config: wisp endpoint for this host, default search engine, whether UDP is enabled. |

Example:

```sh
curl http://localhost:8080/api/config
# {"name":"mi-proxy","wispEndpoint":"ws://localhost:8080/wisp/","defaultSearchEngine":"https://www.google.com/search?q=%s","udpEnabled":true}
```

## Configuration

All settings are read from environment variables (see `.env.example`):

| Variable                  | Default                              | Description                                    |
| -------------------------- | ------------------------------------- | ----------------------------------------------- |
| `PORT`                     | `8080`                                | HTTP port to listen on.                          |
| `SEARCH_ENGINE`             | `https://www.google.com/search?q=%s` | Used when address-bar input isn't a URL.          |
| `WISP_ALLOW_UDP`            | `true`                                | Allow UDP-over-Wisp streams.                     |
| `WISP_HOSTNAME_BLACKLIST`   | *(empty)*                             | Comma-separated regexes of hosts to block.        |
| `WISP_DNS_SERVERS`          | `1.1.1.1,1.0.0.1`                     | Comma-separated resolvers the wisp server uses.   |
| `WISP_LOG_LEVEL`            | `none`                                | Set to `debug` for verbose wisp server logs.      |

## Project layout

```
src/index.js     Fastify server: static hosting, wisp mount, REST API
public/          Frontend: address bar UI, service worker, Scramjet wiring
```

## Legal / attribution

mi-proxy's proxying engine is [Scramjet](https://github.com/MercuryWorkshop/scramjet)
by Mercury Workshop, used here as an npm dependency along with its
`bare-mux`, `libcurl-transport`, and `wisp-js` companion packages. Those
packages are licensed AGPL-3.0; this repository's own code is GPL-3.0 (see
`LICENSE`). Running a modified version of this proxy as a network service
requires making that modified source available to its users per the AGPL —
keeping your fork public on GitHub (or similar) satisfies that.

Only run this against traffic and sites you're authorized to proxy, and
follow the terms of service of whatever host you deploy it on.
