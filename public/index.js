"use strict";

const form = document.getElementById("mp-form");
const address = document.getElementById("mp-address");
const status = document.getElementById("mp-status");
const errorCode = document.getElementById("mp-error-code");

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

let config = null;
async function getConfig() {
	if (config) return config;
	try {
		const res = await fetch("/api/config");
		config = await res.json();
	} catch {
		// The API is unreachable for some reason (offline, blocked, etc). Fall
		// back to deriving everything from the current page's own location, so
		// the proxy still works without a second domain or the API responding.
		config = {
			wispEndpoint: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`,
			defaultSearchEngine: "https://www.google.com/search?q=%s",
		};
	}
	return config;
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	status.textContent = "";
	errorCode.textContent = "";

	try {
		await registerSW();
	} catch (err) {
		status.textContent = "Failed to register the service worker.";
		errorCode.textContent = err.toString();
		throw err;
	}

	const { wispEndpoint, defaultSearchEngine } = await getConfig();
	const url = search(address.value, defaultSearchEngine);

	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispEndpoint }]);
	}

	const frame = scramjet.createFrame();
	frame.frame.id = "mp-frame";
	document.body.appendChild(frame.frame);
	frame.go(url);
});
