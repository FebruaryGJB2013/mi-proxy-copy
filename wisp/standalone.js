import "dotenv/config";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { server as wisp, logging } from "./index.js";

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

const httpServer = createServer((req, res) => {
	res.writeHead(200, { "content-type": "text/plain" });
	res.end("This is a standalone Wisp server. Connect to it over a WebSocket.\n");
});

httpServer.on("upgrade", (req, socket, head) => {
	wisp.routeRequest(req, socket, head);
});

httpServer.on("listening", () => {
	const address = httpServer.address();
	console.log("Standalone Wisp server listening on:");
	console.log(`  ws://localhost:${address.port}/`);
	console.log(`  ws://${hostname()}:${address.port}/`);
	console.log(
		`  ws://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}/`,
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	httpServer.close();
	process.exit(0);
}

let port = parseInt(process.env.WISP_PORT || "", 10);
if (Number.isNaN(port)) port = 8081;

httpServer.listen(port, "0.0.0.0");
