import { WebSocketServer } from "ws";
import { WispConnection } from "./connection.js";

const LogLevel = { NONE: 0, DEBUG: 1 };

class WispServer {
	constructor() {
		this.options = {
			allow_udp_streams: true,
			hostname_blacklist: [],
			dns_servers: [],
		};
		this.logLevel = LogLevel.NONE;
		this.wss = new WebSocketServer({ noServer: true });
	}

	log(...args) {
		if (this.logLevel !== LogLevel.NONE) console.log("[wisp]", ...args);
	}

	routeRequest(req, socket, head) {
		const useV2 = Boolean(req.headers["sec-websocket-protocol"]);
		this.wss.handleUpgrade(req, socket, head, (ws) => {
			this.log("connection opened", useV2 ? "(v2)" : "(v1)");
			new WispConnection(this, ws, useV2);
		});
	}
}

export const server = new WispServer();

export const logging = {
	NONE: LogLevel.NONE,
	DEBUG: LogLevel.DEBUG,
	set_level(level) {
		server.logLevel = level;
	},
};
