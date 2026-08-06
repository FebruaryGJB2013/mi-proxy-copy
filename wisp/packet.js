const HEADER_SIZE = 5;

export function encodePacket(type, streamId, payload = Buffer.alloc(0)) {
	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt8(type, 0);
	header.writeUInt32LE(streamId >>> 0, 1);
	return Buffer.concat([header, payload]);
}

export function decodePacket(buf) {
	if (buf.length < HEADER_SIZE) return null;
	return {
		type: buf.readUInt8(0),
		streamId: buf.readUInt32LE(1),
		payload: buf.subarray(HEADER_SIZE),
	};
}

export function encodeConnect(streamType, port, hostname) {
	const hostBuf = Buffer.from(hostname, "utf8");
	const buf = Buffer.alloc(3 + hostBuf.length);
	buf.writeUInt8(streamType, 0);
	buf.writeUInt16LE(port, 1);
	hostBuf.copy(buf, 3);
	return buf;
}

export function decodeConnect(payload) {
	if (payload.length < 3) return null;
	return {
		streamType: payload.readUInt8(0),
		port: payload.readUInt16LE(1),
		hostname: payload.subarray(3).toString("utf8"),
	};
}

export function encodeContinue(bufferRemaining) {
	const buf = Buffer.alloc(4);
	buf.writeUInt32LE(bufferRemaining >>> 0, 0);
	return buf;
}

export function decodeContinue(payload) {
	if (payload.length < 4) return null;
	return { bufferRemaining: payload.readUInt32LE(0) };
}

export function encodeClose(reason) {
	return Buffer.from([reason & 0xff]);
}

export function decodeClose(payload) {
	return { reason: payload.length > 0 ? payload.readUInt8(0) : 0x01 };
}

export function encodeInfo(majorVersion, minorVersion, extensions = []) {
	const parts = [Buffer.from([majorVersion & 0xff, minorVersion & 0xff])];
	for (const ext of extensions) {
		const extHeader = Buffer.alloc(5);
		extHeader.writeUInt8(ext.id, 0);
		extHeader.writeUInt32LE(ext.payload.length, 1);
		parts.push(extHeader, ext.payload);
	}
	return Buffer.concat(parts);
}

export function decodeInfo(payload) {
	if (payload.length < 2) return null;
	const majorVersion = payload.readUInt8(0);
	const minorVersion = payload.readUInt8(1);
	const extensions = [];
	let offset = 2;
	while (offset + 5 <= payload.length) {
		const id = payload.readUInt8(offset);
		const len = payload.readUInt32LE(offset + 1);
		const extPayload = payload.subarray(offset + 5, offset + 5 + len);
		extensions.push({ id, payload: extPayload });
		offset += 5 + len;
	}
	return { majorVersion, minorVersion, extensions };
}
