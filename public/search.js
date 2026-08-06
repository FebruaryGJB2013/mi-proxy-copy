"use strict";
function search(input, template) {
	try {
		return new URL(input).toString();
	} catch {}

	try {
		const url = new URL(`http://${input}`);
		if (url.hostname.includes(".")) return url.toString();
	} catch {}

	return template.replace("%s", encodeURIComponent(input));
}
