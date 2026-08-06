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

function attemptWispConnection(wispUrl, timeoutMs) {
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

async function checkWispReachable(wispUrl, timeoutMs = 7000, attempts = 2) {
	for (let i = 0; i < attempts; i++) {
		if (await attemptWispConnection(wispUrl, timeoutMs)) return true;
	}
	return false;
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

async function prepareConnection({ skipCheck = false } = {}) {
	const cfg = await getConfig();
	if (!skipCheck) {
		const reachable = await checkWispReachable(cfg.wispEndpoint);
		if (!reachable) {
			throw new Error(
				`Could not reach this proxy's own tunnel server at ${cfg.wispEndpoint}. If this is running behind a port-forwarding proxy (Codespaces, ngrok, etc.), make sure it forwards WebSocket connections.`,
			);
		}
	}
	await ensureTransport(cfg.wispEndpoint);
	return cfg;
}

function renderRetryLink(container, message, onRetry) {
	container.innerHTML = "";
	container.appendChild(document.createTextNode(message + " "));
	const retry = document.createElement("a");
	retry.href = "#";
	retry.className = "mp-retry-link";
	retry.textContent = "Try loading it anyway";
	retry.addEventListener("click", (event) => {
		event.preventDefault();
		onRetry();
	});
	container.appendChild(retry);
}

const homeEl = document.getElementById("mp-home");
const form = document.getElementById("mp-form");
const address = document.getElementById("mp-address");
const status = document.getElementById("mp-status");
const errorCode = document.getElementById("mp-error-code");
const browserEl = document.getElementById("mp-browser");

async function goBasic(rawInput, { skipCheck = false } = {}) {
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
		cfg = await prepareConnection({ skipCheck });
	} catch (err) {
		status.textContent = "Failed to connect to the proxy.";
		renderRetryLink(errorCode, err.message, () => goBasic(rawInput, { skipCheck: true }));
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
let headless = false;
let trustedOrigin = null;

function serializeTab(tab) {
	return { id: tab.id, url: tab.url, title: tab.title, active: tab.id === activeTabId };
}

function notifyParent(type, extra = {}) {
	if (!headless || window.parent === window) return;
	window.parent.postMessage({ type, ...extra }, trustedOrigin || "*");
}

function notifyTabs() {
	notifyParent("mi-proxy:tabs", { tabs: tabs.map(serializeTab) });
}

function showBrowserError(message, onRetry) {
	if (onRetry) {
		renderRetryLink(browserStatus, message, () => {
			hideBrowserError();
			onRetry();
		});
	} else {
		browserStatus.textContent = message;
	}
	browserStatus.hidden = false;
	notifyParent("mi-proxy:error", { message });
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
	notifyTabs();
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

async function loadTabFrame(tab, rawInput, { skipCheck = false } = {}) {
	try {
		await registerSW();
	} catch (err) {
		showBrowserError("Failed to register the service worker: " + err);
		return;
	}
	let cfg;
	try {
		cfg = await prepareConnection({ skipCheck });
	} catch (err) {
		showBrowserError(err.message, () => loadTabFrame(tab, rawInput, { skipCheck: true }));
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

function createTab(saved, activate = true, persisted = false) {
	const tab = {
		id: saved?.id || crypto.randomUUID(),
		url: saved?.url || null,
		title: saved?.title || "New tab",
		frame: null,
		persisted,
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

async function saveTab(tab) {
	tab.persisted = true;
	return fetch("/api/tabs", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ id: tab.id, url: tab.url, title: tab.title }),
	});
}

async function syncTab(tab) {
	if (!tab.url) return;
	try {
		if (!tab.persisted) {
			await saveTab(tab);
			return;
		}
		const res = await fetch(`/api/tabs/${tab.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: tab.url, title: tab.title }),
		});
		if (res.status === 404) await saveTab(tab);
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
		for (const entry of saved) createTab(entry, false, true);
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

function handleParentMessage(event) {
	if (trustedOrigin && event.origin !== trustedOrigin) return;
	const data = event.data;
	if (!data || typeof data !== "object" || !String(data.type || "").startsWith("mi-proxy:")) return;

	switch (data.type) {
		case "mi-proxy:navigate": {
			const tab = tabs.find((t) => t.id === activeTabId) || createTab(undefined, false);
			if (tab.id !== activeTabId) activateTab(tab.id);
			if (typeof data.url === "string") loadTabFrame(tab, data.url);
			break;
		}
		case "mi-proxy:new-tab": {
			createTab(typeof data.url === "string" ? { url: data.url } : undefined);
			break;
		}
		case "mi-proxy:switch-tab":
			if (typeof data.id === "string") activateTab(data.id);
			break;
		case "mi-proxy:close-tab":
			if (typeof data.id === "string") closeTab(data.id);
			break;
		case "mi-proxy:list-tabs":
			notifyTabs();
			break;
		case "mi-proxy:back":
			tabs.find((t) => t.id === activeTabId)?.frame?.back();
			break;
		case "mi-proxy:forward":
			tabs.find((t) => t.id === activeTabId)?.frame?.forward();
			break;
		case "mi-proxy:reload":
			tabs.find((t) => t.id === activeTabId)?.frame?.reload();
			break;
	}
}

function initEmbedMode(initialUrl) {
	headless = true;
	const params = new URLSearchParams(location.search);
	trustedOrigin = params.get("trustedOrigin") || null;

	homeEl.remove();
	browserEl.hidden = false;
	browserEl.classList.add("mp-headless");

	window.addEventListener("message", handleParentMessage);
	if (initialUrl) createTab({ url: initialUrl });
	notifyParent("mi-proxy:ready");
}

(function init() {
	const params = new URLSearchParams(location.search);
	const embedUrl = params.get("url");
	if (embedUrl || params.has("embed")) {
		initEmbedMode(embedUrl || undefined);
		return;
	}
	applyTransportUI();
	applyMode(getMode());
})();
