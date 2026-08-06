"use strict";

const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});
scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

const TRANSPORTS = {
	libcurl: "/libcurl/index.mjs",
	epoxy: "/epoxy/index.mjs",
};

let config = null;
async function getConfig() {
	if (config) return config;
	try {
		const res = await fetch("/api/config");
		config = await res.json();
	} catch {
		config = {
			wispEndpoint: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`,
			defaultSearchEngine: "https://www.google.com/search?q=%s",
		};
	}
	return config;
}

function checkWispReachable(wispUrl, timeoutMs = 4000) {
	return new Promise((resolve) => {
		let settled = false;
		let ws;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			ws?.close();
			resolve(false);
		}, timeoutMs);
		try {
			ws = new WebSocket(wispUrl);
		} catch {
			clearTimeout(timer);
			resolve(false);
			return;
		}
		ws.addEventListener("open", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			ws.close();
			resolve(true);
		});
		ws.addEventListener("error", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(false);
		});
	});
}

function getTransportPreference() {
	return localStorage.getItem("mp:transport") === "epoxy" ? "epoxy" : "libcurl";
}

let transportReady = null;
async function ensureTransport(wispEndpoint) {
	if (transportReady === wispEndpoint) return;
	const preferred = getTransportPreference();
	const path = TRANSPORTS[preferred];
	const args = preferred === "epoxy" ? [{ wisp: wispEndpoint }] : [{ websocket: wispEndpoint }];
	await connection.setTransport(path, args);
	transportReady = wispEndpoint;
}

async function prepareConnection() {
	const cfg = await getConfig();
	const reachable = await checkWispReachable(cfg.wispEndpoint);
	if (!reachable) {
		throw new Error(
			`Could not reach this proxy's own tunnel server at ${cfg.wispEndpoint}. If this is running behind a port-forwarding proxy (Codespaces, ngrok, etc.), make sure it forwards WebSocket connections.`,
		);
	}
	await ensureTransport(cfg.wispEndpoint);
	return cfg;
}

const homeEl = document.getElementById("mp-home");
const form = document.getElementById("mp-form");
const address = document.getElementById("mp-address");
const status = document.getElementById("mp-status");
const errorCode = document.getElementById("mp-error-code");
const browserEl = document.getElementById("mp-browser");

async function goBasic(rawInput) {
	status.textContent = "";
	errorCode.textContent = "";
	try {
		await registerSW();
	} catch (err) {
		status.textContent = "Failed to register the service worker.";
		errorCode.textContent = err.toString();
		return;
	}
	let cfg;
	try {
		cfg = await prepareConnection();
	} catch (err) {
		status.textContent = "Failed to connect to the proxy.";
		errorCode.textContent = err.toString();
		return;
	}
	const url = search(rawInput, cfg.defaultSearchEngine);
	const frame = scramjet.createFrame();
	frame.frame.id = "mp-frame";
	document.body.appendChild(frame.frame);
	homeEl.hidden = true;
	frame.go(url);
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	goBasic(address.value);
});

const tabsEl = document.getElementById("mp-tabs");
const contentEl = document.getElementById("mp-content");
const newTabBtn = document.getElementById("mp-newtab");
const backBtn = document.getElementById("mp-back");
const forwardBtn = document.getElementById("mp-forward");
const reloadBtn = document.getElementById("mp-reload");
const browserForm = document.getElementById("mp-browser-form");
const browserAddress = document.getElementById("mp-browser-address");
const modeSwitchBtn = document.getElementById("mp-mode-switch");
const browserStatus = document.getElementById("mp-browser-status");

const placeholderEl = document.createElement("div");
placeholderEl.className = "mp-tab-placeholder";
placeholderEl.textContent = "Type an address above and press Enter to start browsing.";
contentEl.appendChild(placeholderEl);

let tabs = [];
let activeTabId = null;
let browserInitialized = false;

function showBrowserError(message) {
	browserStatus.textContent = message;
	browserStatus.hidden = false;
}

function hideBrowserError() {
	browserStatus.hidden = true;
}

function renderTabBar() {
	tabsEl.innerHTML = "";
	for (const tab of tabs) {
		const el = document.createElement("div");
		el.className = "mp-tab" + (tab.id === activeTabId ? " active" : "");
		const label = document.createElement("span");
		label.textContent = tab.title;
		const close = document.createElement("span");
		close.className = "mp-tab-close";
		close.textContent = "×";
		close.addEventListener("click", (event) => {
			event.stopPropagation();
			closeTab(tab.id);
		});
		el.append(label, close);
		el.addEventListener("click", () => activateTab(tab.id));
		tabsEl.appendChild(el);
	}
}

function renderContentPlaceholder() {
	const tab = tabs.find((t) => t.id === activeTabId);
	placeholderEl.style.display = tab && !tab.frame ? "flex" : "none";
}

function createTabFrame(tab) {
	const frame = scramjet.createFrame();
	frame.frame.className = "mp-tab-frame";
	frame.frame.style.display = tab.id === activeTabId ? "block" : "none";
	contentEl.appendChild(frame.frame);
	tab.frame = frame;
	frame.addEventListener("urlchange", (event) => {
		tab.url = event.url;
		if (tab.id === activeTabId) browserAddress.value = event.url;
		syncTab(tab);
	});
	frame.frame.addEventListener("load", () => {
		try {
			const title = frame.frame.contentDocument?.title;
			if (title) {
				tab.title = title;
				renderTabBar();
				syncTab(tab);
			}
		} catch {}
	});
	return frame;
}

async function loadTabFrame(tab, rawInput) {
	try {
		await registerSW();
	} catch (err) {
		showBrowserError("Failed to register the service worker: " + err);
		return;
	}
	let cfg;
	try {
		cfg = await prepareConnection();
	} catch (err) {
		showBrowserError(err.message);
		return;
	}
	hideBrowserError();
	const resolved = search(rawInput, cfg.defaultSearchEngine);
	if (!tab.frame) createTabFrame(tab);
	tab.url = resolved;
	if (tab.id === activeTabId) browserAddress.value = resolved;
	renderTabBar();
	renderContentPlaceholder();
	tab.frame.go(resolved);
	syncTab(tab);
}

async function activateTab(id) {
	activeTabId = id;
	for (const tab of tabs) {
		if (tab.frame) tab.frame.frame.style.display = tab.id === id ? "block" : "none";
	}
	const tab = tabs.find((t) => t.id === id);
	renderTabBar();
	renderContentPlaceholder();
	browserAddress.value = tab?.url || "";
	if (tab && tab.url && !tab.frame) {
		await loadTabFrame(tab, tab.url);
	} else if (!tab?.url) {
		browserAddress.focus();
	}
}

function createTab(saved, activate = true) {
	const tab = {
		id: saved?.id || crypto.randomUUID(),
		url: saved?.url || null,
		title: saved?.title || "New tab",
		frame: null,
		persisted: Boolean(saved),
	};
	tabs.push(tab);
	if (activate) activateTab(tab.id);
	else renderTabBar();
	return tab;
}

function closeTab(id) {
	const idx = tabs.findIndex((t) => t.id === id);
	if (idx === -1) return;
	const [tab] = tabs.splice(idx, 1);
	tab.frame?.frame.remove();
	if (tab.persisted) deleteTabRemote(tab.id);
	if (tabs.length === 0) {
		createTab();
	} else if (activeTabId === id) {
		const next = tabs[idx] || tabs[idx - 1];
		activateTab(next.id);
	} else {
		renderTabBar();
	}
}

async function syncTab(tab) {
	if (!tab.url) return;
	try {
		if (tab.persisted) {
			await fetch(`/api/tabs/${tab.id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: tab.url, title: tab.title }),
			});
		} else {
			tab.persisted = true;
			await fetch("/api/tabs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: tab.id, url: tab.url, title: tab.title }),
			});
		}
	} catch {}
}

async function deleteTabRemote(id) {
	try {
		await fetch(`/api/tabs/${id}`, { method: "DELETE" });
	} catch {}
}

newTabBtn.addEventListener("click", () => createTab());

browserForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const tab = tabs.find((t) => t.id === activeTabId);
	const value = browserAddress.value.trim();
	if (!tab || !value) return;
	loadTabFrame(tab, value);
});

backBtn.addEventListener("click", () => tabs.find((t) => t.id === activeTabId)?.frame?.back());
forwardBtn.addEventListener("click", () => tabs.find((t) => t.id === activeTabId)?.frame?.forward());
reloadBtn.addEventListener("click", () => tabs.find((t) => t.id === activeTabId)?.frame?.reload());

async function initBrowserMode() {
	if (browserInitialized) return;
	browserInitialized = true;
	let saved = [];
	try {
		const res = await fetch("/api/tabs");
		const data = await res.json();
		saved = data.tabs || [];
	} catch {}
	if (saved.length === 0) {
		createTab();
	} else {
		for (const entry of saved) createTab(entry, false);
		activateTab(tabs[0].id);
	}
}

function teardownBrowserMode() {
	for (const tab of tabs) tab.frame?.frame.remove();
	tabs = [];
	activeTabId = null;
	browserInitialized = false;
}

modeSwitchBtn.addEventListener("click", () => setMode("basic"));

const modeButtons = document.querySelectorAll(".mode-toggle button[data-mode]");
function getMode() {
	return localStorage.getItem("mp:ui-mode") === "browser" ? "browser" : "basic";
}
function applyMode(mode) {
	modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
	if (mode === "browser") {
		homeEl.hidden = true;
		browserEl.hidden = false;
		initBrowserMode();
	} else {
		teardownBrowserMode();
		homeEl.hidden = false;
		browserEl.hidden = true;
	}
}
function setMode(mode) {
	localStorage.setItem("mp:ui-mode", mode);
	applyMode(mode);
}
modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

const transportButtons = document.querySelectorAll("#mp-transport-toggle button");
function applyTransportUI() {
	const pref = getTransportPreference();
	transportButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.transport === pref));
}
transportButtons.forEach((btn) =>
	btn.addEventListener("click", () => {
		localStorage.setItem("mp:transport", btn.dataset.transport);
		transportReady = null;
		applyTransportUI();
	}),
);

async function goEmbed(rawUrl) {
	try {
		await registerSW();
		const cfg = await prepareConnection();
		const url = search(rawUrl, cfg.defaultSearchEngine);
		const frame = scramjet.createFrame();
		frame.frame.id = "mp-frame";
		document.body.appendChild(frame.frame);
		frame.go(url);
	} catch (err) {
		document.body.innerHTML = `<pre style="color:#ff6b6b;padding:16px;white-space:pre-wrap;">${String(err)}</pre>`;
	}
}

(function init() {
	const params = new URLSearchParams(location.search);
	const embedUrl = params.get("url");
	if (embedUrl) {
		homeEl.remove();
		browserEl.remove();
		goEmbed(embedUrl);
		return;
	}
	applyTransportUI();
	applyMode(getMode());
})();
