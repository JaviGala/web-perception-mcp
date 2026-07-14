import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildVisualPrompt,
	parseVisualResult,
	sendToVisionModel,
	validateImageFile,
} from "../src/vision.js";

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

function keepEventLoopAlive() {
	return setTimeout(() => {}, 1000);
}

function count(text, fragment) {
	return text.split(fragment).length - 1;
}

test("validateImageFile accepts PNG files inside allowed roots", () => {
	const path = createPng();

	const result = validateImageFile(path);
	assert.equal(result.mimeType, "image/png");
	assert.equal(result.ext, "png");
	assert.equal(result.size > 0, true);
});

test("validateImageFile rejects invalid path values with a stable code", () => {
	for (const value of ["", "   ", "image\0.png", null, 42]) {
		assert.throws(
			() => validateImageFile(value),
			(err) => {
				assert.equal(err.code, "IMAGE_PATH_INVALID");
				return true;
			},
		);
	}
});

test("validateImageFile rejects missing files with a stable code", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const path = join(dir, "missing.png");

	assert.throws(
		() => validateImageFile(path),
		(err) => {
			assert.equal(err.code, "IMAGE_PATH_NOT_FOUND");
			return true;
		},
	);
});

test("validateImageFile rejects paths outside configured roots", () => {
	const allowedDir = mkdtempSync(join(tmpdir(), "web-perception-allowed-"));
	const outsideDir = mkdtempSync(join(tmpdir(), "web-perception-outside-"));
	const path = join(outsideDir, "pixel.png");
	const previousAllowedDirs = process.env.ALLOWED_IMAGE_DIRS;
	writeFileSync(path, onePixelPng);
	process.env.ALLOWED_IMAGE_DIRS = allowedDir;

	try {
		assert.throws(
			() => validateImageFile(path),
			(err) => {
				assert.equal(err.code, "IMAGE_PATH_NOT_ALLOWED");
				return true;
			},
		);
	} finally {
		restoreEnv("ALLOWED_IMAGE_DIRS", previousAllowedDirs);
	}
});

test("validateImageFile rejects directories with a stable code", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const previousAllowedDirs = process.env.ALLOWED_IMAGE_DIRS;
	process.env.ALLOWED_IMAGE_DIRS = dir;

	try {
		assert.throws(
			() => validateImageFile(dir),
			(err) => {
				assert.equal(err.code, "IMAGE_PATH_NOT_REGULAR_FILE");
				return true;
			},
		);
	} finally {
		restoreEnv("ALLOWED_IMAGE_DIRS", previousAllowedDirs);
	}
});

test("validateImageFile rejects empty files with a stable code", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const path = join(dir, "empty.png");
	writeFileSync(path, Buffer.alloc(0));

	assert.throws(
		() => validateImageFile(path),
		(err) => {
			assert.equal(err.code, "IMAGE_FILE_EMPTY");
			return true;
		},
	);
});

test("validateImageFile rejects oversized files with a stable code", () => {
	const path = createPng();
	const previousMaxBytes = process.env.MAX_IMAGE_BYTES;
	process.env.MAX_IMAGE_BYTES = "1";

	try {
		assert.throws(
			() => validateImageFile(path),
			(err) => {
				assert.equal(err.code, "IMAGE_FILE_TOO_LARGE");
				return true;
			},
		);
	} finally {
		restoreEnv("MAX_IMAGE_BYTES", previousMaxBytes);
	}
});

test("validateImageFile rejects unsupported file signatures with a stable code", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const path = join(dir, "not-image.png");
	writeFileSync(path, "not actually an image");

	assert.throws(
		() => validateImageFile(path),
		(err) => {
			assert.equal(err.code, "IMAGE_TYPE_UNSUPPORTED");
			return true;
		},
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
		assert.equal(bodies[0].messages[0].content[0].text, "Describe the image");
		assert.equal("response_format" in bodies[0], false);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
		restoreEnv("VISION_MAX_TOKENS", previousMaxTokens);
	}
});

test("sendToVisionModel rejects excessive image counts before fetch", async () => {
	const firstPath = createPng();
	const secondPath = createPng();
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousMaxImages = process.env.MAX_IMAGES_PER_REQUEST;
	let fetchCalls = 0;

	process.env.VISION_API_KEY = "test-key";
	process.env.MAX_IMAGES_PER_REQUEST = "1";
	globalThis.fetch = async () => {
		fetchCalls += 1;
		throw new Error("fetch should not be called");
	};

	try {
		await assert.rejects(
			() => sendToVisionModel("Describe the images", [firstPath, secondPath]),
			(err) => {
				assert.equal(err.code, "IMAGE_COUNT_LIMIT_EXCEEDED");
				return true;
			},
		);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("MAX_IMAGES_PER_REQUEST", previousMaxImages);
	}
});

test("sendToVisionModel preserves validation codes and does not call fetch", async () => {
	const allowedDir = mkdtempSync(join(tmpdir(), "web-perception-allowed-"));
	const outsideDir = mkdtempSync(join(tmpdir(), "web-perception-outside-"));
	const path = join(outsideDir, "pixel.png");
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousAllowedDirs = process.env.ALLOWED_IMAGE_DIRS;
	let fetchCalls = 0;

	writeFileSync(path, onePixelPng);
	process.env.VISION_API_KEY = "test-key";
	process.env.ALLOWED_IMAGE_DIRS = allowedDir;
	globalThis.fetch = async () => {
		fetchCalls += 1;
		throw new Error("fetch should not be called");
	};

	try {
		await assert.rejects(
			() => sendToVisionModel("Describe the image", [path]),
			(err) => {
				assert.equal(err.code, "IMAGE_PATH_NOT_ALLOWED");
				return true;
			},
		);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("ALLOWED_IMAGE_DIRS", previousAllowedDirs);
	}
});

test("sendToVisionModel aborts stalled provider requests", async () => {
	const path = createPng();
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousBaseUrl = process.env.VISION_BASE_URL;
	const previousTimeout = process.env.VISION_TIMEOUT_MS;
	const keepAlive = keepEventLoopAlive();

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
		clearTimeout(keepAlive);
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
		restoreEnv("VISION_TIMEOUT_MS", previousTimeout);
	}
});

test("sendToVisionModel normalizes timeouts while reading the response body", async () => {
	const path = createPng();
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousBaseUrl = process.env.VISION_BASE_URL;
	const previousTimeout = process.env.VISION_TIMEOUT_MS;
	const keepAlive = keepEventLoopAlive();

	process.env.VISION_API_KEY = "test-key";
	process.env.VISION_BASE_URL = "https://vision.example/v1";
	process.env.VISION_TIMEOUT_MS = "10";
	globalThis.fetch = async (_url, options) => ({
		ok: true,
		json: async () => new Promise((resolve, reject) => {
			const abort = () => reject(options.signal.reason);
			if (options.signal.aborted) abort();
			else options.signal.addEventListener("abort", abort, { once: true });
		}),
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
		clearTimeout(keepAlive);
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
		restoreEnv("VISION_TIMEOUT_MS", previousTimeout);
	}
});

test("buildVisualPrompt applies the shared visual and security instructions", () => {
	const prompt = buildVisualPrompt(null, "Describe the image");

	assert.match(prompt, /^You are a vision-capable analysis model/);
	assert.match(prompt, /SECURITY BOUNDARY:/);
	assert.match(prompt, /USER QUESTION:\nDescribe the image/);
	assert.match(prompt, /Separate direct visual observations from interpretation/);
	assert.doesNotMatch(prompt, /OUTPUT FORMAT — MANDATORY/);
});

test("sendToVisionModel appends one JSON contract after all visual context", async () => {
	const path = createPng();
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousBaseUrl = process.env.VISION_BASE_URL;
	let body;

	process.env.VISION_API_KEY = "test-key";
	process.env.VISION_BASE_URL = "https://vision.example/v1";
	globalThis.fetch = async (_url, options) => {
		body = JSON.parse(options.body);
		return new Response(
			JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: null }),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	const prompt = `${buildVisualPrompt(
		{ url: "https://example.com", title: "Example Domain" },
		"Describe the visible interface",
	)}\n\nSCREENSHOT SEGMENTS:\n- Section 1: y=0, height=900`;

	try {
		await sendToVisionModel(prompt, [path], { responseFormat: "json_object" });

		const sentPrompt = body.messages[0].content[0].text;
		assert.equal(count(sentPrompt, "OUTPUT FORMAT — MANDATORY"), 1);
		assert.ok(sentPrompt.indexOf("SCREENSHOT SEGMENTS:") < sentPrompt.indexOf("OUTPUT FORMAT — MANDATORY"));
		assert.match(sentPrompt, /Before responding, verify that the result parses as JSON\.$/);
		assert.deepEqual(body.response_format, { type: "json_object" });
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
	}
});

test("parseVisualResult fallback matches the structured output contract", () => {
	const result = parseVisualResult("# Markdown response");

	assert.equal(result.usedFallback, true);
	assert.deepEqual(result.findings, {
		summary: "# Markdown response",
		observations: [],
		interpretations: [],
		uncertainty: ["Vision response was not valid JSON."],
	});
});
