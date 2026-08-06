import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";
import { server as wisp, logging } from "../wisp/index.js";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyCompress from "@fastify/compress";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const require = createRequire(import.meta.url);
const epoxyPath = dirname(require.resolve("@mercuryworkshop/epoxy-transport"));

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const startedAt = Date.now();

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

await fastify.register(fastifyCompress, { global: true });
await fastify.register(fastifyCookie);

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

const vendorDirs = [
	["/scram/", scramjetPath],
	["/libcurl/", libcurlPath],
	["/epoxy/", epoxyPath],
	["/baremux/", baremuxPath],
];

for (const [prefix, root] of vendorDirs) {
	fastify.register(fastifyStatic, {
		root,
		prefix,
		decorateReply: false,
		maxAge: "1d",
	});
}

const SESSION_COOKIE = "mp_sid";
const sessions = new Map();

function getSession(request, reply) {
	let id = request.cookies[SESSION_COOKIE];
	if (!id || !sessions.has(id)) {
		id = randomUUID();
		sessions.set(id, new Map());
		reply.setCookie(SESSION_COOKIE, id, {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			maxAge: 60 * 60 * 24 * 30,
		});
	}
	return sessions.get(id);
}

fastify.get("/api/health", async () => ({
	status: "ok",
	uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
}));

fastify.get("/api/config", async (request) => {
	const host = request.headers["x-forwarded-host"] || request.headers.host;
	const proto = request.headers["x-forwarded-proto"] || request.protocol;
	const wsProto = proto === "https" ? "wss" : "ws";
	return {
		name: "mi-proxy",
		wispEndpoint: `${wsProto}://${host}/wisp/`,
		defaultSearchEngine: process.env.SEARCH_ENGINE || "https://www.google.com/search?q=%s",
		udpEnabled: wisp.options.allow_udp_streams,
		transports: {
			libcurl: "/libcurl/index.mjs",
			epoxy: "/epoxy/index.mjs",
		},
	};
});

fastify.get("/api/tabs", async (request, reply) => {
	const tabs = getSession(request, reply);
	return { tabs: [...tabs.values()] };
});

fastify.post("/api/tabs", async (request, reply) => {
	const tabs = getSession(request, reply);
	const { id, url, title } = request.body ?? {};
	if (typeof url !== "string" || url.length === 0) {
		return reply.code(400).send({ status: "error", message: "url is required" });
	}
	const tab = { id: typeof id === "string" && id.length > 0 ? id : randomUUID(), url, title: title || url, createdAt: Date.now() };
	tabs.set(tab.id, tab);
	return reply.code(201).send(tab);
});

fastify.put("/api/tabs/:id", async (request, reply) => {
	const tabs = getSession(request, reply);
	const tab = tabs.get(request.params.id);
	if (!tab) return reply.code(404).send({ status: "error", message: "Tab not found" });
	const { url, title } = request.body ?? {};
	if (typeof url === "string" && url.length > 0) tab.url = url;
	if (typeof title === "string" && title.length > 0) tab.title = title;
	return tab;
});

fastify.delete("/api/tabs/:id", async (request, reply) => {
	const tabs = getSession(request, reply);
	tabs.delete(request.params.id);
	return reply.code(204).send();
});

fastify.delete("/api/tabs", async (request, reply) => {
	const tabs = getSession(request, reply);
	tabs.clear();
	return reply.code(204).send();
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
	console.log("The Wisp server is mounted at /wisp/ on the same origin above.");
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "", 10);
if (Number.isNaN(port)) port = 8080;

fastify.listen({ port, host: "0.0.0.0" });
