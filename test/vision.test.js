import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateImageFile } from "../src/vision.js";

const onePixelPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzMZVwAAAABJRU5ErkJggg==",
	"base64",
);

test("validateImageFile accepts PNG files inside allowed roots", () => {
	const dir = mkdtempSync(join(tmpdir(), "web-perception-"));
	const path = join(dir, "pixel.png");
	writeFileSync(path, onePixelPng);

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
