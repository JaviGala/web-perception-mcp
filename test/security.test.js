import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
	parseDomainList,
	safeFetchText,
	validateUrl,
	validateUrlResolved,
} from "../src/security.js";

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve(server.address().port);
		});
	});
}

function close(server) {
	return new Promise((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
}

test("validateUrl accepts normal http and https URLs", () => {
	assert.equal(validateUrl("https://example.com").ok, true);
	assert.equal(validateUrl("http://example.com/path").ok, true);
});

test("validateUrl rejects unsupported protocols", () => {
	const result = validateUrl("file:///etc/passwd");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "URL_PROTOCOL_NOT_ALLOWED");
});

test("validateUrl blocks localhost and private/raw IP targets by default", () => {
	for (const url of [
		"http://localhost:3000",
		"http://127.0.0.1",
		"http://10.0.0.1",
		"http://192.168.1.10",
		"http://169.254.169.254/latest/meta-data",
	]) {
		const result = validateUrl(url);
		assert.equal(result.ok, false, `${url} should be blocked`);
	}
});

test("validateUrl allows loopback only when explicitly enabled", () => {
	const result = validateUrl("http://127.0.0.1:3000", {
		allowLocalhost: true,
	});
	assert.equal(result.ok, true);

	const privateLan = validateUrl("http://192.168.1.10", {
		allowLocalhost: true,
	});
	assert.equal(privateLan.ok, false);
});

test("validateUrl enforces allowed and blocked domain options", () => {
	assert.equal(
		validateUrl("https://docs.example.com", {
			allowedDomains: ["example.com"],
		}).ok,
		true,
	);

	const notAllowed = validateUrl("https://example.org", {
		allowedDomains: ["example.com"],
	});
	assert.equal(notAllowed.ok, false);
	assert.equal(notAllowed.error.code, "URL_DOMAIN_NOT_ALLOWED");

	const blocked = validateUrl("https://tracking.example.com", {
		blockedDomains: ["tracking.example.com"],
	});
	assert.equal(blocked.ok, false);
	assert.equal(blocked.error.code, "URL_DOMAIN_BLOCKED");
});

test("parseDomainList normalizes comma-separated env values", () => {
	assert.deepEqual(parseDomainList(" Example.com, .foo.test. , ,BAR.dev "), [
		"example.com",
		"foo.test",
		"bar.dev",
	]);
});

test("validateUrlResolved blocks hostnames that resolve to loopback by default", async () => {
	const result = await validateUrlResolved("http://localhost:3000");
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "URL_BLOCKED_PRIVATE_IP");
});

test("safeFetchText follows safe relative redirects", async () => {
	const server = createServer((req, res) => {
		if (req.url === "/redirect") {
			res.writeHead(302, { Location: "/ok" });
			res.end();
			return;
		}

		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<h1>OK</h1>");
	});

	const port = await listen(server);
	try {
		const result = await safeFetchText(`http://127.0.0.1:${port}/redirect`, {
			allowLocalhost: true,
			maxRedirects: 2,
		});
		assert.equal(result.response.status, 200);
		assert.equal(result.finalUrl, `http://127.0.0.1:${port}/ok`);
		assert.match(result.text, /OK/);
		assert.deepEqual(result.redirects, [`http://127.0.0.1:${port}/ok`]);
	} finally {
		await close(server);
	}
});

test("safeFetchText blocks redirects to metadata/private targets", async () => {
	const server = createServer((req, res) => {
		res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
		res.end();
	});

	const port = await listen(server);
	try {
		await assert.rejects(
			() =>
				safeFetchText(`http://127.0.0.1:${port}/redirect`, {
					allowLocalhost: true,
					maxRedirects: 2,
				}),
			(err) => {
				assert.equal(err.code, "REDIRECT_BLOCKED_METADATA_IP");
				return true;
			},
		);
	} finally {
		await close(server);
	}
});
