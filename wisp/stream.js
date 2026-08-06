import net from "node:net";
import dgram from "node:dgram";
import * as packet from "./packet.js";
import { PacketType, StreamType, CloseReason, INITIAL_BUFFER_SIZE } from "./constants.js";
import { createResolver, resolveHost } from "./dns.js";

const CONNECT_TIMEOUT_MS = 10000;
const MAX_UDP_PACKET_SIZE = 65507;

export class Stream {
	constructor(connection, id, streamType) {
		this.connection = connection;
		this.id = id;
		this.streamType = streamType;
		this.socket = null;
		this.closed = false;
		this.ready = false;
		this.pendingData = [];
		this.receivedSinceContinue = 0;
	}

	async connect(hostname, port) {
		const { options } = this.connection.server;

		for (const pattern of options.hostname_blacklist) {
			if (pattern.test(hostname)) {
				this.closeLocal(CloseReason.BLOCKED);
				return;
			}
		}

		if (this.streamType === StreamType.UDP && !options.allow_udp_streams) {
			this.closeLocal(CloseReason.INVALID_INFO);
			return;
		}

		let address;
		try {
			address = await resolveHost(createResolver(options.dns_servers), hostname);
		} catch {
			this.closeLocal(CloseReason.UNREACHABLE);
			return;
		}
		if (this.closed) return;

		if (this.streamType === StreamType.UDP) {
			this.connectUdp(address, port);
		} else {
			this.connectTcp(address, port);
		}
	}

	connectTcp(address, port) {
		const socket = net.connect({ host: address, port });
		this.socket = socket;
		socket.setTimeout(CONNECT_TIMEOUT_MS);
		this.markReady();

		socket.once("connect", () => {
			socket.setTimeout(0);
			this.connection.confirmStreamOpen(this.id);
		});

		socket.on("data", (chunk) => this.forwardToClient(chunk));

		socket.once("timeout", () => {
			socket.destroy();
			this.closeLocal(CloseReason.TIMEOUT);
		});

		socket.once("error", (err) => {
			this.closeLocal(err.code === "ECONNREFUSED" ? CloseReason.REFUSED : CloseReason.NETWORK_ERROR);
		});

		socket.once("close", () => {
			if (!this.closed) this.closeLocal(CloseReason.VOLUNTARY);
		});
	}

	connectUdp(address, port) {
		const socket = dgram.createSocket(net.isIPv6(address) ? "udp6" : "udp4");
		this.socket = socket;

		socket.on("message", (chunk) => this.forwardToClient(chunk));

		socket.once("error", () => {
			this.closeLocal(CloseReason.NETWORK_ERROR);
		});

		socket.once("connect", () => {
			this.connection.confirmStreamOpen(this.id);
			this.markReady();
		});
		try {
			socket.connect(port, address);
		} catch {
			this.closeLocal(CloseReason.UNREACHABLE);
		}
	}

	markReady() {
		this.ready = true;
		const pending = this.pendingData;
		this.pendingData = [];
		for (const chunk of pending) this.writeData(chunk);
	}

	forwardToClient(chunk) {
		if (this.closed) return;
		if (this.streamType === StreamType.TCP) this.socket.pause();
		this.connection.sendPacket(PacketType.DATA, this.id, chunk, () => {
			if (!this.closed && this.streamType === StreamType.TCP) this.socket.resume();
		});
	}

	handleData(chunk) {
		if (this.closed) return;
		if (!this.ready) {
			this.pendingData.push(chunk);
			return;
		}
		this.writeData(chunk);
	}

	writeData(chunk) {
		if (this.streamType === StreamType.UDP) {
			if (chunk.length > MAX_UDP_PACKET_SIZE) return;
			this.socket.send(chunk);
		} else {
			this.socket.write(chunk);
		}

		if (this.streamType === StreamType.TCP) {
			this.receivedSinceContinue++;
			if (this.receivedSinceContinue >= INITIAL_BUFFER_SIZE) {
				this.receivedSinceContinue = 0;
				this.connection.sendPacket(PacketType.CONTINUE, this.id, packet.encodeContinue(INITIAL_BUFFER_SIZE));
			}
		}
	}

	closeLocal(reason) {
		if (this.closed) return;
		this.closed = true;
		this.connection.sendPacket(PacketType.CLOSE, this.id, packet.encodeClose(reason));
		this.destroySocket();
		this.connection.removeStream(this.id);
	}

	closeRemote() {
		if (this.closed) return;
		this.closed = true;
		this.destroySocket();
		this.connection.removeStream(this.id);
	}

	destroySocket() {
		if (!this.socket) return;
		if (this.streamType === StreamType.UDP) this.socket.close();
		else this.socket.destroy();
		this.socket = null;
	}
}
