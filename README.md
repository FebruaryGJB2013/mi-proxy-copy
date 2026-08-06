# mi-proxy

New here? [**GUIDE.md**](./GUIDE.md) is a beginner-friendly walkthrough —
running it, using Basic/Browser mode, reskinning it, and embedding it in
your own page (including switching tabs from the parent page). This README
is the technical/API reference.

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
  instance without hardcoding URLs, plus server-side tab/session storage.
- **Two ways to browse**: a plain "basic" mode (one address bar, the proxied
  site takes over the page), or a "browser" mode with real chrome — tabs,
  back/forward/reload, an always-visible address bar — with your tabs saved
  server-side and restored next time you visit.
- **Embeddable**: drop `?url=<target>` on the homepage URL and mi-proxy skips
  its own UI entirely and loads straight into that site — handy for putting
  it in an `<iframe>` on another page.
- **Two selectable transports** (libcurl and epoxy) for compatibility with
  different network environments, plus a connectivity check that gives a
  clear error instead of a dead page when the wisp tunnel can't be reached.

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

1. Runs its own Wisp server (`wisp/`, a from-scratch implementation — see
   below) inside the same Node process as the web server, handling the HTTP
   `upgrade` event on requests to `/wisp/` (see `src/index.js`).
2. Never hardcodes a wisp URL. The frontend always computes the wisp
   endpoint itself from `location.protocol`/`location.host` — the one thing
   guaranteed to match whatever address the browser is actually using to
   reach the page, even behind a proxy that rewrites the `Host` header the
   server sees (Codespaces, some tunnels). So whatever address you're using
   to reach the proxy is the address the tunnel connects through too.

This means deploying mi-proxy anywhere that gives you a single reachable
address is enough — a VPS with just an IP, a `.local`/LAN hostname, a free
subdomain, whatever you've got.

Before every navigation, the frontend also opens a quick test WebSocket to
that same wisp endpoint. If it can't connect (e.g. a port-forwarding proxy
in front of mi-proxy that doesn't forward WebSocket upgrades), you get an
explicit error explaining that, instead of a generic broken page.

## Basic mode vs. Browser mode

Pick either from the toggle on the homepage (remembered per-browser):

- **Basic** — the classic single address bar. Submitting it replaces the
  page with the proxied site full-screen. No chrome, nothing to load beyond
  that one frame.
- **Browser** — persistent tab bar + toolbar (back / forward / reload) on
  top, proxied sites load into tabs underneath. Tabs are lazily loaded (a
  new tab doesn't spin anything up until you actually navigate it) and are
  saved to the server as you browse, so reopening mi-proxy in Browser mode
  restores where you left off.

## Embedding mi-proxy in an iframe

Add a `url` query parameter to the homepage and mi-proxy skips its own UI
and navigates straight there:

```html
<iframe src="https://your-mi-proxy.example/?url=https://example.com"></iframe>
```

Without `url` (or `embed`), it behaves like any normal visit and shows the
homepage.

For full programmatic control — opening/switching/closing tabs from your
own page's UI via `postMessage`, using `?embed` instead of `?url` — see
["Embedding mi-proxy in your own page"](./GUIDE.md#5-embedding-mi-proxy-in-your-own-page)
in the guide.

## REST API

| Method | Path            | Description                                             |
| ------ | --------------- | -------------------------------------------------------- |
| GET    | `/api/health`   | Liveness check + process uptime.                          |
| GET    | `/api/config`   | Public config: wisp endpoint for this host, default search engine, UDP flag, transport module paths. |
| GET    | `/api/tabs`     | List this browser's saved tabs (session tracked via an httpOnly cookie). |
| POST   | `/api/tabs`     | Save a tab. Body: `{ id?, url, title? }`. `id` is optional — pass your own to keep client/server ids in sync, otherwise one is generated. |
| PUT    | `/api/tabs/:id` | Update a saved tab's `url`/`title`.                        |
| DELETE | `/api/tabs/:id` | Remove one saved tab.                                     |
| DELETE | `/api/tabs`     | Clear all saved tabs for this session.                     |

Tab storage is in-memory per server process (no database to install) — it
resets on restart and doesn't survive a multi-instance/load-balanced
deployment.

Example:

```sh
curl http://localhost:8080/api/config
# {"name":"mi-proxy","wispEndpoint":"ws://localhost:8080/wisp/","defaultSearchEngine":"https://www.google.com/search?q=%s","udpEnabled":true,"transports":{"libcurl":"/libcurl/index.mjs","epoxy":"/epoxy/index.mjs"}}
```

## Performance & compatibility

- Responses are compressed (gzip/brotli) and vendor proxy assets are served
  with a day-long cache header, so repeat visits and navigations are faster.
- Two bare-mux transports are bundled — **libcurl** (default) and **epoxy**.
  If sites fail to load in your environment, try switching transport from
  the toggle on the homepage; it's a client-side preference (`localStorage`)
  and takes effect on the next navigation.

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
wisp/            Wisp v1/v2 tunnel server (own implementation, see wisp/README.md)
```

## The Wisp server

`wisp/` is a from-scratch implementation of the
[Wisp protocol](https://github.com/MercuryWorkshop/wisp-protocol) (both v1
and v2 — it picks whichever a connecting client asks for), replacing the
`@mercuryworkshop/wisp-js` dependency used earlier. It speaks the same
packet protocol as any other Wisp server, so any Wisp-speaking client
(Scramjet's bundled libcurl-transport/epoxy-transport, or anything else)
works against it unmodified. See `wisp/README.md` for the protocol
breakdown and design notes.

## Legal / attribution

mi-proxy's proxying engine is [Scramjet](https://github.com/MercuryWorkshop/scramjet)
by Mercury Workshop, used here as an npm dependency along with its
`bare-mux`, `libcurl-transport`, and `epoxy-transport` companion
packages. Those packages are licensed AGPL-3.0; this repository's own code
is GPL-3.0 (see
`LICENSE`). Running a modified version of this proxy as a network service
requires making that modified source available to its users per the AGPL —
keeping your fork public on GitHub (or similar) satisfies that.

Only run this against traffic and sites you're authorized to proxy, and
follow the terms of service of whatever host you deploy it on.

### this was made by the help of claude ofc i coded some of the stuff but it wont show since this was merged
