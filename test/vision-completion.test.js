import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	sendToVisionModel,
	visionCompletionWarnings,
} from "../src/vision.js";

const onePixelPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzMZVwAAAABJRU5ErkJggg==",
	"base64",
);

function createPng() {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-finish-"));
	const path = join(dir, "pixel.png");
	writeFileSync(path, onePixelPng);
	return path;
}

function restoreEnv(name, previousValue) {
	if (previousValue === undefined) delete process.env[name];
	else process.env[name] = previousValue;
}

async function runWithProviderResponse(payload) {
	const previousFetch = globalThis.fetch;
	const previousApiKey = process.env.VISION_API_KEY;
	const previousBaseUrl = process.env.VISION_BASE_URL;
	process.env.VISION_API_KEY = "test-key";
	process.env.VISION_BASE_URL = "https://vision.example/v1";
	globalThis.fetch = async () => new Response(
		JSON.stringify(payload),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);

	try {
		return await sendToVisionModel("Describe the image", [createPng()]);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
	}
}

test("sendToVisionModel preserves normal provider finish reasons without warnings", async () => {
	const result = await runWithProviderResponse({
		choices: [{ message: { content: "Complete analysis" }, finish_reason: "stop" }],
		usage: { completion_tokens: 42 },
	});

	assert.equal(result.content, "Complete analysis");
	assert.equal(result.finishReason, "stop");
	assert.deepEqual(visionCompletionWarnings(result), []);
});

test("sendToVisionModel warns when the provider stops at the output length limit", async () => {
	const result = await runWithProviderResponse({
		choices: [{ message: { content: "Partial analysis" }, finish_reason: "length" }],
		usage: { completion_tokens: 2000 },
	});

	assert.equal(result.content, "Partial analysis");
	assert.equal(result.finishReason, "length");
	assert.deepEqual(visionCompletionWarnings(result), [
		"Vision provider stopped the response because the output length limit was reached. The analysis may be incomplete.",
	]);
});

test("sendToVisionModel does not infer truncation when finish_reason is absent", async () => {
	const result = await runWithProviderResponse({
		choices: [{ message: { content: "Provider omitted finish reason" } }],
		usage: { completion_tokens: 2000 },
	});

	assert.equal(result.finishReason, null);
	assert.deepEqual(visionCompletionWarnings(result), []);
});
