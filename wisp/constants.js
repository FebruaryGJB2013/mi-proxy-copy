export const PacketType = {
	CONNECT: 0x01,
	DATA: 0x02,
	CONTINUE: 0x03,
	CLOSE: 0x04,
	INFO: 0x05,
};

export const StreamType = {
	TCP: 0x01,
	UDP: 0x02,
};

export const CloseReason = {
	UNSPECIFIED: 0x01,
	VOLUNTARY: 0x02,
	NETWORK_ERROR: 0x03,
	EXTENSIONS_INCOMPATIBLE: 0x04,
	INVALID_INFO: 0x41,
	UNREACHABLE: 0x42,
	TIMEOUT: 0x43,
	REFUSED: 0x44,
	DATA_TIMEOUT: 0x47,
	BLOCKED: 0x48,
	THROTTLED: 0x49,
	CLIENT_ERROR: 0x81,
};

export const ExtensionId = {
	UDP: 0x01,
	PASSWORD_AUTH: 0x02,
	KEY_AUTH: 0x03,
	MOTD: 0x04,
	STREAM_OPEN_CONFIRMATION: 0x05,
};

export const INITIAL_BUFFER_SIZE = 128;
export const WISP_VERSION = { major: 2, minor: 0 };
