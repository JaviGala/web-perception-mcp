import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sendToVisionModel, validateImageFile } from "../src/vision.js";

const onePixelPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzMZVwAAAABJRU5ErkJggg==",
	"base64",
);

function createPng() {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const path = join(dir, "pixel.png");
	writeFileSync(path, onePixelPng);
	return path;
}

function restoreEnv(name, previousValue) {
	if (previousValue === undefined) delete process.env[name];
	else process.env[name] = previousValue;
}

test("validateImageFile accepts PNG files inside allowed roots", () => {
	const path = createPng();

	const result = validateImageFile(path);
	assert.equal(result.mimeType, "image/png");
	assert.equal(result.ext, "png");
	assert.equal(result.size > 0, true);
});

test("validateImageFile rejects unsupported file signatures", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const path = join(dir, "not-image.png");
	writeFileSync(path, "not actually an image");

	assert.throws(
		() => validateImageFile(path),
		/Unsupported or untrusted image file type/,
	);
});

test("invalid numeric image limits fall back to safe defaults", () => {
	const previousMaxBytes = process.env.MAX_IMAGE_BYTES;
	process.env.MAX_IMAGE_BYTES = "not-a-number";
	try {
		const result = validateImageFile(createPng());
		assert.equal(result.mimeType, "image/png");
	} finally {
		restoreEnv("MAX_IMAGE_BYTES", previousMaxBytes);
	}
});

test("sendToVisionModel uses configured max tokens unless the call overrides it", async () => {
	const path = createPng();
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousBaseUrl = process.env.VISION_BASE_URL;
	const previousMaxTokens = process.env.VISION_MAX_TOKENS;
	const bodies = [];

	process.env.VISION_API_KEY = "test-key";
	process.env.VISION_BASE_URL = "https://vision.example/v1";
	process.env.VISION_MAX_TOKENS = "4321";
	globalThis.fetch = async (_url, options) => {
		bodies.push(JSON.parse(options.body));
		return new Response(
			JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: null }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	try {
		await sendToVisionModel("Describe the image", [path]);
		await sendToVisionModel("Describe the image", [path], { maxTokens: 321 });
		assert.equal(bodies[0].max_tokens, 4321);
		assert.equal(bodies[1].max_tokens, 321);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
		restoreEnv("VISION_MAX_TOKENS", previousMaxTokens);
	}
});

test("sendToVisionModel aborts stalled provider requests", async () => {
	const path = createPng();
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousBaseUrl = process.env.VISION_BASE_URL;
	const previousTimeout = process.env.VISION_TIMEOUT_MS;

	process.env.VISION_API_KEY = "test-key";
	process.env.VISION_BASE_URL = "https://vision.example/v1";
	process.env.VISION_TIMEOUT_MS = "10";
	globalThis.fetch = async (_url, options) => new Promise((resolve, reject) => {
		const abort = () => reject(options.signal.reason);
		if (options.signal.aborted) abort();
		else options.signal.addEventListener("abort", abort, { once: true });
	});

	try {
		await assert.rejects(
			() => sendToVisionModel("Describe the image", [path]),
			(err) => {
				assert.equal(err.code, "VISION_API_TIMEOUT");
				assert.match(err.message, /timed out after 10ms/);
				return true;
			},
		);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
		restoreEnv("VISION_TIMEOUT_MS", previousTimeout);
	}
});
