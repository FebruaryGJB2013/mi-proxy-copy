"use strict";
/**
 * Turns raw address-bar input into a fully qualified URL: passes real URLs
 * through, guesses the scheme for bare domains, and falls back to a search
 * query for everything else.
 * @param {string} input
 * @param {string} template Search query template containing "%s"
 * @returns {string}
 */
function search(input, template) {
	try {
		return new URL(input).toString();
	} catch {
		// not already a valid URL
	}

	try {
		const url = new URL(`http://${input}`);
		if (url.hostname.includes(".")) return url.toString();
	} catch {
		// still not a valid URL
	}

	return template.replace("%s", encodeURIComponent(input));
}
