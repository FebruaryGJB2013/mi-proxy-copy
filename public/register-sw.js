"use strict";
const stockSW = "./sw.js";

/**
 * Hostnames allowed to run a service worker over plain http://
 */
const swAllowedHostnames = ["localhost", "127.0.0.1"];

async function registerSW() {
	if (!navigator.serviceWorker) {
		if (location.protocol !== "https:" && !swAllowedHostnames.includes(location.hostname)) {
			throw new Error("Service workers require HTTPS (or localhost).");
		}
		throw new Error("This browser doesn't support service workers.");
	}

	await navigator.serviceWorker.register(stockSW);
}
