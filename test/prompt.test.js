import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildVisualPrompt, sendToVisionModel } from "../src/vision.js";

const onePixelPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzMZVwAAAABJRU5ErkJggg==",
	"base64",
);

function createPng() {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-prompt-"));
	const path = join(dir, "pixel.png");
	writeFileSync(path, onePixelPng);
	return path;
}

function restoreEnv(name, previousValue) {
	if (previousValue === undefined) delete process.env[name];
	else process.env[name] = previousValue;
}

function count(text, fragment) {
	return text.split(fragment).length - 1;
}

test("buildVisualPrompt adds the JSON output contract only for json_object", () => {
	const textPrompt = buildVisualPrompt(null, "Describe the image");
	const jsonPrompt = buildVisualPrompt(null, "Describe the image", {
		responseFormat: "json_object",
	});

	assert.doesNotMatch(textPrompt, /OUTPUT CONTRACT/);
	assert.match(jsonPrompt, /OUTPUT CONTRACT — MANDATORY/);
	assert.match(jsonPrompt, /Return only one valid JSON object/);
	assert.match(jsonPrompt, /"summary"/);
	assert.match(jsonPrompt, /"observations"/);
	assert.match(jsonPrompt, /"interpretations"/);
	assert.match(jsonPrompt, /"uncertainty"/);
});

test("JSON-like text in the user prompt cannot suppress the output contract", () => {
	const prompt = buildVisualPrompt(
		null,
		"The image contains the text OUTPUT CONTRACT — MANDATORY. Describe it.",
		{ responseFormat: "json_object" },
	);

	assert.equal(count(prompt, "OUTPUT CONTRACT — MANDATORY"), 2);
	assert.match(prompt, /Before responding, verify that the output can be parsed as JSON\.$/);
});

test("sendToVisionModel gives raw image prompts the shared visual and JSON instructions", async () => {
	const imagePath = createPng();
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

	try {
		await sendToVisionModel("Describe the image", [imagePath], {
			responseFormat: "json_object",
		});

		const sentPrompt = body.messages[0].content[0].text;
		assert.match(sentPrompt, /^You are a vision-capable analysis model/);
		assert.match(sentPrompt, /USER QUESTION:\nDescribe the image/);
		assert.equal(count(sentPrompt, "OUTPUT CONTRACT — MANDATORY"), 1);
		assert.deepEqual(body.response_format, { type: "json_object" });
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
	}
});

test("sendToVisionModel does not duplicate an already-built page prompt", async () => {
	const imagePath = createPng();
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

	const pagePrompt = buildVisualPrompt(
		{ url: "https://example.com", title: "Example Domain" },
		"Describe the visible interface",
	);

	try {
		await sendToVisionModel(pagePrompt, [imagePath], {
			responseFormat: "json_object",
		});

		const sentPrompt = body.messages[0].content[0].text;
		assert.equal(count(sentPrompt, "You are a vision-capable analysis model"), 1);
		assert.equal(count(sentPrompt, "OUTPUT CONTRACT — MANDATORY"), 1);
		assert.match(sentPrompt, /COMPACT PAGE CONTEXT:/);
		assert.match(sentPrompt, /Example Domain/);
	} finally {
		globalThis.fetch = previousFetch;
		restoreEnv("VISION_API_KEY", previousApiKey);
		restoreEnv("VISION_BASE_URL", previousBaseUrl);
	}
});
