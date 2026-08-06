import * as packet from "./packet.js";
import { PacketType, StreamType, CloseReason, ExtensionId, INITIAL_BUFFER_SIZE, WISP_VERSION } from "./constants.js";
import { Stream } from "./stream.js";

export class WispConnection {
	constructor(server, ws, useV2) {
		this.server = server;
		this.ws = ws;
		this.useV2 = useV2;
		this.streams = new Map();
		this.awaitingClientInfo = useV2;
		this.streamOpenConfirmation = false;

		ws.on("message", (data) => this.handleMessage(data));
		ws.on("close", () => this.handleClose());
		ws.on("error", () => this.handleClose());

		this.begin();
	}

	begin() {
		if (this.useV2) {
			const extensions = [{ id: ExtensionId.STREAM_OPEN_CONFIRMATION, payload: Buffer.alloc(0) }];
			if (this.server.options.allow_udp_streams) {
				extensions.push({ id: ExtensionId.UDP, payload: Buffer.alloc(0) });
			}
			this.sendPacket(PacketType.INFO, 0, packet.encodeInfo(WISP_VERSION.major, WISP_VERSION.minor, extensions));
		} else {
			this.sendPacket(PacketType.CONTINUE, 0, packet.encodeContinue(INITIAL_BUFFER_SIZE));
		}
	}

	handleMessage(data) {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		const pkt = packet.decodePacket(buf);
		if (!pkt) return;

		if (this.awaitingClientInfo) {
			if (pkt.type !== PacketType.INFO || pkt.streamId !== 0) return;
			const info = packet.decodeInfo(pkt.payload);
			this.streamOpenConfirmation =
				info?.extensions.some((ext) => ext.id === ExtensionId.STREAM_OPEN_CONFIRMATION) ?? false;
			this.awaitingClientInfo = false;
			this.sendPacket(PacketType.CONTINUE, 0, packet.encodeContinue(INITIAL_BUFFER_SIZE));
			return;
		}

		switch (pkt.type) {
			case PacketType.CONNECT:
				this.handleConnect(pkt.streamId, pkt.payload);
				break;
			case PacketType.DATA:
				this.streams.get(pkt.streamId)?.handleData(pkt.payload);
				break;
			case PacketType.CLOSE:
				this.streams.get(pkt.streamId)?.closeRemote();
				break;
			default:
				break;
		}
	}

	handleConnect(streamId, payload) {
		if (this.streams.has(streamId)) return;
		const info = packet.decodeConnect(payload);
		if (!info || (info.streamType !== StreamType.TCP && info.streamType !== StreamType.UDP)) {
			this.sendPacket(PacketType.CLOSE, streamId, packet.encodeClose(CloseReason.INVALID_INFO));
			return;
		}
		const stream = new Stream(this, streamId, info.streamType);
		this.streams.set(streamId, stream);
		stream.connect(info.hostname, info.port);
	}

	confirmStreamOpen(streamId) {
		if (this.useV2 && this.streamOpenConfirmation) {
			this.sendPacket(PacketType.CONTINUE, streamId, packet.encodeContinue(INITIAL_BUFFER_SIZE));
		}
	}

	sendPacket(type, streamId, payload, callback) {
		if (this.ws.readyState !== this.ws.OPEN) {
			callback?.();
			return;
		}
		try {
			this.ws.send(packet.encodePacket(type, streamId, payload), callback);
		} catch {
			callback?.();
		}
	}

	removeStream(streamId) {
		this.streams.delete(streamId);
	}

	handleClose() {
		for (const stream of this.streams.values()) stream.closeRemote();
		this.streams.clear();
	}
}
