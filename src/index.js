import "dotenv/config";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const startedAt = Date.now();

// --- Wisp server configuration -------------------------------------------
// The Wisp server (which tunnels TCP/UDP over WebSocket for the proxy) is
// mounted at /wisp/ on this SAME http server/origin below, instead of
// pointing at some separately hosted public wisp instance. The frontend
// (public/index.js) builds the wisp URL from `location.host` at runtime, so
// whatever domain (or plain IP/port, e.g. http://localhost:8080) this app is
// reached at is automatically also the wisp endpoint. No second domain, DNS
// record, or external wisp provider is ever required.
logging.set_level(process.env.WISP_LOG_LEVEL === "debug" ? logging.DEBUG : logging.NONE);

Object.assign(wisp.options, {
	allow_udp_streams: process.env.WISP_ALLOW_UDP !== "false",
	hostname_blacklist: (process.env.WISP_HOSTNAME_BLACKLIST || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => new RegExp(entry)),
	dns_servers: (process.env.WISP_DNS_SERVERS || "1.1.1.1,1.0.0.1")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean),
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				// Required for the proxy's service worker / wasm rewriter to run.
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/")) {
					wisp.routeRequest(req, socket, head);
				} else {
					socket.end();
				}
			});
	},
});

// --- Static assets ---------------------------------------------------------
fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

// --- REST API ----------------------------------------------------------
// Small JSON API for health checks, monitoring, and other apps that want to
// discover how to reach this instance's proxy/wisp endpoints programmatically
// instead of hardcoding them.
fastify.get("/api/health", async () => ({
	status: "ok",
	uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
}));

fastify.get("/api/config", async (request) => {
	const host = request.headers.host;
	const proto = request.headers["x-forwarded-proto"] || request.protocol;
	const wsProto = proto === "https" ? "wss" : "ws";
	return {
		name: "mi-proxy",
		wispEndpoint: `${wsProto}://${host}/wisp/`,
		defaultSearchEngine: process.env.SEARCH_ENGINE || "https://www.google.com/search?q=%s",
		udpEnabled: wisp.options.allow_udp_streams,
	};
});

fastify.setNotFoundHandler((request, reply) => {
	if (request.raw.url?.startsWith("/api/")) {
		return reply.code(404).send({ status: "error", message: "Not found" });
	}
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	console.log("mi-proxy is listening on:");
	console.log(`  http://localhost:${address.port}`);
	console.log(`  http://${hostname()}:${address.port}`);
	console.log(
		`  http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`,
	);
	console.log("The Wisp server is mounted at /wisp/ on the same origin above — no separate domain needed.");
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("Shutting down mi-proxy...");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "", 10);
if (Number.isNaN(port)) port = 8080;

fastify.listen({ port, host: "0.0.0.0" });
