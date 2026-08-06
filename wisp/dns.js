import dns from "node:dns";
import net from "node:net";

export function createResolver(dnsServers) {
	if (!dnsServers || dnsServers.length === 0) return null;
	const resolver = new dns.Resolver();
	resolver.setServers(dnsServers);
	return resolver;
}

export function resolveHost(resolver, hostname) {
	if (net.isIP(hostname) || !resolver) return Promise.resolve(hostname);
	return new Promise((resolve, reject) => {
		resolver.resolve4(hostname, (err4, addresses4) => {
			if (!err4 && addresses4.length > 0) {
				resolve(addresses4[0]);
				return;
			}
			resolver.resolve6(hostname, (err6, addresses6) => {
				if (!err6 && addresses6.length > 0) {
					resolve(addresses6[0]);
					return;
				}
				reject(err4 || err6 || new Error(`Could not resolve ${hostname}`));
			});
		});
	});
}
