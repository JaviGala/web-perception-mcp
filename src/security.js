// security.js — URL validation, SSRF protection, size limits, safe logging

import { readFileSync, existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// ─── Configuration ───────────────────────────────────────────────────────────

const BLOCKED_HOSTS = [
	"metadata.google.internal",
	"instance-data",
	"169.254.169.254", // AWS/GCP/Azure metadata
];

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024;

// ─── Errors ──────────────────────────────────────────────────────────────────

function securityError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

// ─── Domain Helpers ──────────────────────────────────────────────────────────

function normalizeDomain(domain) {
	return String(domain || "")
		.trim()
		.toLowerCase()
		.replace(/^\.+|\.+$/g, "");
}

/**
 * Parse a comma-separated env var into normalized domain names.
 * @param {string|undefined} value
 * @returns {string[]}
 */
export function parseDomainList(value) {
	if (!value) return [];
	return value
		.split(",")
		.map(normalizeDomain)
		.filter(Boolean);
}

function domainMatches(hostname, domain) {
	const host = normalizeDomain(hostname);
	const d = normalizeDomain(domain);
	return host === d || host.endsWith(`.${d}`);
}

// ─── IP Validation ───────────────────────────────────────────────────────────

function ipv4ToInt(ip) {
	const parts = ip.split(".").map((part) => Number(part));
	if (
		parts.length !== 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return null;
	}

	return (
		((parts[0] << 24) >>> 0) +
		((parts[1] << 16) >>> 0) +
		((parts[2] << 8) >>> 0) +
		parts[3]
	);
}

function ipv4InCidr(ip, base, prefix) {
	const ipInt = ipv4ToInt(ip);
	const baseInt = ipv4ToInt(base);
	if (ipInt === null || baseInt === null) return false;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (ipInt & mask) === (baseInt & mask);
}

/**
 * Check if an IPv4 address is loopback.
 * @param {string} ip
 * @returns {boolean}
 */
export function isLoopbackIPv4(ip) {
	return ipv4InCidr(ip, "127.0.0.0", 8);
}

/**
 * Check if an IPv4 address is private/reserved enough to block for SSRF.
 * @param {string} ip
 * @returns {boolean}
 */
export function isReservedIPv4(ip) {
	return [
		["0.0.0.0", 8], // current network
		["10.0.0.0", 8], // RFC1918
		["100.64.0.0", 10], // carrier-grade NAT
		["127.0.0.0", 8], // loopback
		["169.254.0.0", 16], // link-local + metadata
		["172.16.0.0", 12], // RFC1918
		["192.0.0.0", 24], // IETF protocol assignments
		["192.0.2.0", 24], // TEST-NET-1
		["192.168.0.0", 16], // RFC1918
		["198.18.0.0", 15], // benchmark networks
		["198.51.100.0", 24], // TEST-NET-2
		["203.0.113.0", 24], // TEST-NET-3
		["224.0.0.0", 4], // multicast
		["240.0.0.0", 4], // reserved
	].some(([base, prefix]) => ipv4InCidr(ip, base, prefix));
}

/**
 * Check if an IPv6 address is loopback.
 * @param {string} ip
 * @returns {boolean}
 */
export function isLoopbackIPv6(ip) {
	return ip.toLowerCase() === "::1";
}

/**
 * Check if an IPv6 address is private/reserved enough to block for SSRF.
 * @param {string} ip
 * @returns {boolean}
 */
export function isReservedIPv6(ip) {
	const normalized = ip.toLowerCase();
	return (
		normalized === "::" ||
		normalized === "::1" ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb")
	);
}

function isLoopbackAddress(address) {
	if (isIP(address) === 4) return isLoopbackIPv4(address);
	if (isIP(address) === 6) return isLoopbackIPv6(address);
	return false;
}

function isReservedAddress(address) {
	if (isIP(address) === 4) return isReservedIPv4(address);
	if (isIP(address) === 6) return isReservedIPv6(address);
	return false;
}

/**
 * Validate a hostname string before DNS resolution.
 * @param {string} hostname
 * @param {object} options
 * @param {boolean} [options.allowLocalhost]
 * @returns {{ ok: true } | { ok: false, reason: string, code?: string }}
 */
function validateHostnameString(hostname, options = {}) {
	if (!hostname) {
		return { ok: false, reason: "Empty hostname", code: "URL_NOT_PARSEABLE" };
	}

	const lc = hostname.toLowerCase();

	if (BLOCKED_HOSTS.includes(lc)) {
		return {
			ok: false,
			reason: `Blocked metadata host: ${hostname}`,
			code: "URL_BLOCKED_METADATA_IP",
		};
	}

	if (lc === "localhost" || lc.endsWith(".localhost")) {
		if (options.allowLocalhost) return { ok: true };
		return {
			ok: false,
			reason: "localhost is blocked",
			code: "URL_BLOCKED_PRIVATE_IP",
		};
	}

	if (lc.endsWith(".local")) {
		return {
			ok: false,
			reason: ".local domains are blocked",
			code: "URL_BLOCKED_PRIVATE_IP",
		};
	}

	const bracketless = hostname.replace(/^\[|\]$/g, "");
	const ipVersion = isIP(bracketless);
	if (ipVersion === 4 || ipVersion === 6) {
		if (isLoopbackAddress(bracketless) && options.allowLocalhost) {
			return { ok: true };
		}

		if (isReservedAddress(bracketless)) {
			return {
				ok: false,
				reason: `IP ${bracketless} is in a private/reserved range`,
				code: "URL_BLOCKED_PRIVATE_IP",
			};
		}

		return {
			ok: false,
			reason: "Raw IP addresses are not allowed. Use a hostname.",
			code: "URL_RAW_IP_NOT_ALLOWED",
		};
	}

	return { ok: true };
}

/**
 * Resolve a hostname and validate all returned addresses.
 * @param {string} hostname
 * @param {object} options
 * @param {boolean} [options.allowLocalhost]
 * @returns {Promise<{ ok: true, addresses: string[] } | { ok: false, reason: string, code?: string }>}
 */
export async function validateResolvedHostname(hostname, options = {}) {
	const hostCheck = validateHostnameString(hostname, options);
	if (!hostCheck.ok) return hostCheck;

	if (hostname.toLowerCase() === "localhost" || hostname.endsWith(".localhost")) {
		return { ok: true, addresses: ["localhost"] };
	}

	try {
		const records = await lookup(hostname, { all: true, verbatim: true });
		const addresses = records.map((record) => record.address);

		for (const address of addresses) {
			if (isLoopbackAddress(address) && options.allowLocalhost) {
				continue;
			}

			if (isReservedAddress(address)) {
				return {
					ok: false,
					reason: `Hostname ${hostname} resolves to private/reserved IP ${address}`,
					code: "URL_BLOCKED_PRIVATE_IP",
				};
			}
		}

		return { ok: true, addresses };
	} catch (err) {
		return {
			ok: false,
			reason: `DNS resolution failed for ${hostname}: ${err.message}`,
			code: "URL_DNS_RESOLUTION_FAILED",
		};
	}
}

// ─── URL Validation ──────────────────────────────────────────────────────────

/**
 * Validate a URL for safety. Returns normalized URL or error.
 * This is a synchronous string-level check. Use validateUrlResolved for DNS-aware checks.
 * @param {string} urlStr
 * @param {object} options
 * @param {string[]} [options.allowedDomains] - allowlist (empty = allow all)
 * @param {string[]} [options.blockedDomains] - denylist
 * @param {boolean} [options.allowLocalhost] - allow localhost/loopback for explicit local dev
 * @returns {{ ok: true, url: URL } | { ok: false, error: { code: string, message: string } }}
 */
export function validateUrl(urlStr, options = {}) {
	if (!urlStr || typeof urlStr !== "string") {
		return {
			ok: false,
			error: {
				code: "URL_NOT_PARSEABLE",
				message: "URL is empty or not a string.",
			},
		};
	}

	let parsed;
	try {
		parsed = new URL(urlStr);
	} catch {
		return {
			ok: false,
			error: {
				code: "URL_NOT_PARSEABLE",
				message: `Cannot parse URL: ${urlStr}`,
			},
		};
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			ok: false,
			error: {
				code: "URL_PROTOCOL_NOT_ALLOWED",
				message: `Protocol "${parsed.protocol}" is not allowed. Only http: and https: are accepted.`,
			},
		};
	}

	const hostCheck = validateHostnameString(parsed.hostname, options);
	if (!hostCheck.ok) {
		return {
			ok: false,
			error: {
				code: hostCheck.code || "URL_BLOCKED_PRIVATE_IP",
				message: hostCheck.reason,
			},
		};
	}

	if (options.allowedDomains && options.allowedDomains.length > 0) {
		const allowed = options.allowedDomains.some((domain) =>
			domainMatches(parsed.hostname, domain),
		);
		if (!allowed) {
			return {
				ok: false,
				error: {
					code: "URL_DOMAIN_NOT_ALLOWED",
					message: `Domain "${parsed.hostname}" is not in the allowed list.`,
				},
			};
		}
	}

	if (options.blockedDomains && options.blockedDomains.length > 0) {
		const blocked = options.blockedDomains.some((domain) =>
			domainMatches(parsed.hostname, domain),
		);
		if (blocked) {
			return {
				ok: false,
				error: {
					code: "URL_DOMAIN_BLOCKED",
					message: `Domain "${parsed.hostname}" is on the blocked list.`,
				},
			};
		}
	}

	return { ok: true, url: parsed };
}

/**
 * Validate a URL and its resolved DNS addresses.
 * @param {string} urlStr
 * @param {object} options
 * @returns {Promise<{ ok: true, url: URL, addresses: string[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function validateUrlResolved(urlStr, options = {}) {
	const result = validateUrl(urlStr, options);
	if (!result.ok) return result;

	const hostCheck = await validateResolvedHostname(result.url.hostname, options);
	if (!hostCheck.ok) {
		return {
			ok: false,
			error: {
				code: hostCheck.code || "URL_BLOCKED_PRIVATE_IP",
				message: hostCheck.reason,
			},
		};
	}

	return {
		ok: true,
		url: result.url,
		addresses: hostCheck.addresses || [],
	};
}

// ─── Redirect Validation ─────────────────────────────────────────────────────

/**
 * Validate a redirect target URL using the same rules as validateUrl.
 * @param {string} redirectUrl
 * @param {object} options - same as validateUrl options
 * @returns {{ ok: true, url: URL } | { ok: false, error: { code: string, message: string } }}
 */
export function validateRedirectUrl(redirectUrl, options = {}) {
	const result = validateUrl(redirectUrl, options);
	if (!result.ok) {
		result.error.code = result.error.code.replace("URL_", "REDIRECT_");
	}
	return result;
}

/**
 * Validate a redirect target URL including DNS resolution.
 * @param {string} redirectUrl
 * @param {object} options - same as validateUrl options
 * @returns {Promise<{ ok: true, url: URL, addresses: string[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function validateRedirectUrlResolved(redirectUrl, options = {}) {
	const result = await validateUrlResolved(redirectUrl, options);
	if (!result.ok) {
		result.error.code = result.error.code.replace("URL_", "REDIRECT_");
	}
	return result;
}

function isRedirectStatus(status) {
	return [301, 302, 303, 307, 308].includes(status);
}

/**
 * Fetch text with manual redirect validation, DNS-aware URL validation, timeout and size checks.
 * @param {string} urlStr
 * @param {object} options
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRedirects]
 * @param {number} [options.maxResponseSizeBytes]
 * @param {object} [options.headers]
 * @param {string[]} [options.allowedDomains]
 * @param {string[]} [options.blockedDomains]
 * @param {boolean} [options.allowLocalhost]
 * @returns {Promise<{ response: Response, text: string, finalUrl: string, redirects: string[] }>}
 */
export async function safeFetchText(urlStr, options = {}) {
	const {
		timeoutMs = 30000,
		maxRedirects = DEFAULT_MAX_REDIRECTS,
		maxResponseSizeBytes = DEFAULT_MAX_RESPONSE_SIZE_BYTES,
		headers = {},
		allowedDomains = [],
		blockedDomains = [],
		allowLocalhost = false,
	} = options;

	let current = await validateUrlResolved(urlStr, {
		allowedDomains,
		blockedDomains,
		allowLocalhost,
	});
	if (!current.ok) {
		throw securityError(current.error.code, current.error.message);
	}

	const redirects = [];

	for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		if (timer && typeof timer.unref === "function") timer.unref();

		let response;
		try {
			response = await fetch(current.url.href, {
				signal: controller.signal,
				redirect: "manual",
				headers,
			});
		} catch (err) {
			if (err.name === "AbortError") {
				throw securityError(
					"REQUEST_TIMEOUT",
					`Request timed out after ${timeoutMs}ms`,
				);
			}
			throw securityError("FETCH_FAILED", `Failed to fetch URL: ${err.message}`);
		} finally {
			clearTimeout(timer);
		}

		if (isRedirectStatus(response.status)) {
			const location = response.headers.get("location");
			if (!location) {
				throw securityError(
					"REDIRECT_LOCATION_MISSING",
					`HTTP ${response.status} redirect did not include a Location header`,
				);
			}

			if (redirectCount === maxRedirects) {
				throw securityError(
					"TOO_MANY_REDIRECTS",
					`Too many redirects; maximum is ${maxRedirects}`,
				);
			}

			const redirectUrl = new URL(location, current.url).href;
			const redirectCheck = await validateRedirectUrlResolved(redirectUrl, {
				allowedDomains,
				blockedDomains,
				allowLocalhost,
			});
			if (!redirectCheck.ok) {
				throw securityError(
					redirectCheck.error.code,
					redirectCheck.error.message,
				);
			}

			redirects.push(redirectCheck.url.href);
			current = redirectCheck;
			continue;
		}

		const contentLength = response.headers.get("content-length");
		if (
			contentLength &&
			Number.parseInt(contentLength, 10) > maxResponseSizeBytes
		) {
			throw securityError(
				"RESPONSE_TOO_LARGE",
				`Response size ${contentLength} exceeds limit of ${maxResponseSizeBytes} bytes`,
			);
		}

		let text;
		try {
			text = await response.text();
		} catch (err) {
			throw securityError("READ_FAILED", `Failed to read response body: ${err.message}`);
		}

		if (text.length > maxResponseSizeBytes) {
			throw securityError(
				"RESPONSE_TOO_LARGE",
				`Response size ${text.length} exceeds limit of ${maxResponseSizeBytes} bytes`,
			);
		}

		return {
			response,
			text,
			finalUrl: current.url.href,
			redirects,
		};
	}

	throw securityError(
		"TOO_MANY_REDIRECTS",
		`Too many redirects; maximum is ${maxRedirects}`,
	);
}

// ─── Safe Logging ────────────────────────────────────────────────────────────

/**
 * Log to stderr. Never to stdout (which is used for MCP stdio transport).
 * @param {"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} [data]
 */
export function safeLog(level, message, data = undefined) {
	const timestamp = new Date().toISOString();
	const prefix = `[web-perception] [${level}] ${timestamp}`;
	const entry = data
		? `${prefix} ${message} ${JSON.stringify(data)}`
		: `${prefix} ${message}`;
	process.stderr.write(entry + "\n");
}

// ─── Size & Length Enforcement ────────────────────────────────────────────────

/**
 * Truncate text to a maximum length, adding a warning marker if truncated.
 * @param {string} text
 * @param {number} maxLength
 * @returns {{ text: string, truncated: boolean }}
 */
export function enforceLimits(text, maxLength) {
	if (!text || text.length <= maxLength) {
		return { text: text || "", truncated: false };
	}
	return {
		text: text.slice(0, maxLength) + "\n\n[... TRUNCATED ...]",
		truncated: true,
	};
}

/**
 * Check if a response body is too large (for streaming checks).
 * @param {number} size - bytes received so far
 * @param {number} maxSize - maximum allowed bytes
 * @returns {boolean} true if over limit
 */
export function isOverSizeLimit(size, maxSize) {
	return size > maxSize;
}

// ─── Timeout Helpers ─────────────────────────────────────────────────────────

/**
 * Create an AbortSignal that fires after a timeout.
 * @param {number} ms - timeout in milliseconds
 * @returns {AbortSignal}
 */
export function createTimeoutSignal(ms) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	if (timer && typeof timer.unref === "function") timer.unref();
	return controller.signal;
}

// ─── Env Helpers ─────────────────────────────────────────────────────────────

/**
 * Load environment variables from a .env file.
 * @param {string} envPath - absolute path to .env file
 */
export function loadEnv(envPath) {
	try {
		if (existsSync(envPath)) {
			const content = readFileSync(envPath, "utf-8");
			for (const line of content.split("\n")) {
				const trimmed = line.trim();
				if (trimmed && !trimmed.startsWith("#")) {
					const eqIndex = trimmed.indexOf("=");
					if (eqIndex > 0) {
						const key = trimmed.substring(0, eqIndex).trim();
						const value = trimmed.substring(eqIndex + 1).trim();
						if (key && value && !process.env[key]) {
							process.env[key] = value;
						}
					}
				}
			}
		}
	} catch {
		// .env is optional
	}
}
