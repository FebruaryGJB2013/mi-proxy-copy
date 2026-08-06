# mi-proxy: beginner's guide

This is a walkthrough for people who have never touched mi-proxy before —
running it, using it, customizing the look, and embedding it in your own
page. For the technical/API reference, see [README.md](./README.md).

## 1. Get it running

```sh
git clone https://github.com/miguelqwe1701/mi-proxy.git
cd mi-proxy
npm install
npm start
```

Open <http://localhost:8080>. If you see the mi-proxy homepage with a
search box, it worked — there's nothing else to configure.

## 2. Using it — Basic mode

This is the default. Type a website (`example.com`) or a search (`cats`)
into the box and hit **Go**. The page you searched for takes over the
whole screen. There's no address bar or back button visible on purpose —
it's meant to feel like just... going to a website.

To leave, use your actual browser's back button, or reload the mi-proxy
page.

## 3. Using it — Browser mode

Click **Browser** next to the search box on the homepage. You now get:

- A tab bar at the top (click **+** for a new tab, click the **×** on a
  tab to close it)
- Back / forward / reload buttons
- An address bar that always shows where you are

Type into the address bar and press Enter to navigate the active tab. This
choice (Basic vs Browser) is remembered in your browser, so next time you
visit mi-proxy it opens in whichever mode you used last.

Your open tabs are saved automatically (to the server, tied to a cookie in
your browser) — close the tab/browser and come back later, and Browser
mode restores them.

## 4. Customizing

### Change basic settings

Copy `.env.example` to `.env` and edit it:

```sh
cp .env.example .env
```

- `PORT` — what port the server listens on
- `SEARCH_ENGINE` — what search engine is used when you type something
  that isn't a URL, e.g. `https://duckduckgo.com/?q=%s`
- `WISP_ALLOW_UDP`, `WISP_DNS_SERVERS`, `WISP_HOSTNAME_BLACKLIST` — tunnel
  server behavior, see the README's configuration table

Restart the server (`npm start`) after changing `.env`.

### Change the look

Open `public/index.css`. Right at the top there's a `:root { ... }` block
with all the colors as variables:

```css
:root {
	--mp-bg: #0d0d12;
	--mp-accent: #7c5cff;
	--mp-text: #fff;
	/* ... */
}
```

Change these and everything (buttons, tabs, borders) updates to match —
you don't need to hunt through the rest of the file.

### Change the name/logo

- Site title: edit the `<title>` tag and the `<h1>mi-proxy</h1>` in
  `public/index.html`.
- Logo: replace `public/favicon.svg` with your own square icon (SVG is
  easiest, but any image works if you update the `<img>`/`<link>` tags
  that reference it).

## 5. Embedding mi-proxy in your own page

You don't have to send people to mi-proxy directly — you can drop it into
an `<iframe>` on another page you control.

### Simplest: open one site, no chrome

```html
<iframe src="https://your-mi-proxy.example/?url=https://example.com"></iframe>
```

This skips mi-proxy's homepage entirely and just shows `example.com`
filling the iframe. No tab bar, no address bar — just the site.

### Controlling it from your page (switching tabs, opening new ones)

If you want your *own* page's UI (your own tab buttons, your own address
bar, whatever) to drive what mi-proxy shows inside the iframe, use
`?embed` instead of `?url`, and talk to it with
[`postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage):

```html
<iframe id="proxy" src="https://your-mi-proxy.example/?embed"></iframe>

<script>
  const proxy = document.getElementById("proxy").contentWindow;

  // wait for mi-proxy to tell us it's ready before sending commands
  window.addEventListener("message", (event) => {
    if (event.data?.type === "mi-proxy:ready") {
      proxy.postMessage({ type: "mi-proxy:new-tab", url: "https://example.com" }, "*");
    }
  });
</script>
```

Messages you can send to the iframe (`proxy.postMessage({...}, "*")`):

| `type`                 | Extra fields | What it does                              |
| ----------------------- | ------------ | ------------------------------------------ |
| `mi-proxy:new-tab`      | `url?`       | Opens a new tab, optionally navigating it immediately. |
| `mi-proxy:navigate`     | `url`        | Navigates the *currently active* tab.       |
| `mi-proxy:switch-tab`   | `id`         | Makes the given tab active/visible.         |
| `mi-proxy:close-tab`    | `id`         | Closes a tab.                               |
| `mi-proxy:back`         | —            | Goes back in the active tab.                |
| `mi-proxy:forward`      | —            | Goes forward in the active tab.             |
| `mi-proxy:reload`       | —            | Reloads the active tab.                     |
| `mi-proxy:list-tabs`    | —            | Asks mi-proxy to send back the current tab list. |

Messages mi-proxy sends back to your page (listen with
`window.addEventListener("message", ...)`):

| `type`             | Fields                          | When                                      |
| -------------------- | -------------------------------- | ------------------------------------------ |
| `mi-proxy:ready`     | —                                 | Once, right after the iframe finishes loading — safe to start sending commands now. |
| `mi-proxy:tabs`      | `tabs: [{id, url, title, active}]` | Whenever the tab list changes (opened, closed, navigated, title changed). |
| `mi-proxy:error`     | `message`                         | When something fails (e.g. the tunnel server couldn't be reached). |

A minimal example that renders your own tab strip driven entirely by
mi-proxy's state:

```html
<div id="tabs"></div>
<iframe id="proxy" src="https://your-mi-proxy.example/?embed"></iframe>

<script>
  const proxyWindow = document.getElementById("proxy").contentWindow;
  const tabsEl = document.getElementById("tabs");

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type === "mi-proxy:ready") {
      proxyWindow.postMessage({ type: "mi-proxy:new-tab", url: "https://example.com" }, "*");
    }
    if (msg?.type === "mi-proxy:tabs") {
      tabsEl.innerHTML = "";
      for (const tab of msg.tabs) {
        const btn = document.createElement("button");
        btn.textContent = tab.title;
        btn.style.fontWeight = tab.active ? "bold" : "normal";
        btn.onclick = () => proxyWindow.postMessage({ type: "mi-proxy:switch-tab", id: tab.id }, "*");
        tabsEl.appendChild(btn);
      }
    }
  });
</script>
```

### Locking it down

By default mi-proxy replies to `postMessage` from any parent origin (using
`"*"`). If you're embedding it on a page whose origin you control, add
`&trustedOrigin=https://your-site.example` to the iframe `src` so mi-proxy
only accepts commands from that exact origin — anyone else framing it
elsewhere can't puppet it:

```html
<iframe src="https://your-mi-proxy.example/?embed&trustedOrigin=https://your-site.example"></iframe>
```

## 6. Troubleshooting

**"Could not reach this proxy's own tunnel server..."** — mi-proxy's
built-in wisp tunnel lives at `/wisp/` on the same address as the site. If
you're running behind something that forwards ports (GitHub Codespaces,
ngrok, a reverse proxy), make sure it forwards WebSocket upgrades too, not
just plain HTTP.

**A site loads partway then breaks, or won't load at all** — try switching
the transport. On the homepage, under the mode toggle, there's a small
`libcurl` / `epoxy` switch — these are two different underlying network
implementations, and some networks are picky about one but not the other.

**A tab shows a "Scramjet" error page instead of the site** — this is
different from the tunnel error above: the tunnel connected fine, but the
*server* mi-proxy is running on couldn't reach the site you asked for
(outbound network/firewall rules on that machine, not your browser). Check
that the server itself has normal outbound internet access — this is common
on locked-down sandboxes/CI containers, less so on a normal VPS or home
server.

**I changed `.env` and nothing happened** — restart the server; it only
reads `.env` on startup.
