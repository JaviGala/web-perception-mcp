import test from "node:test";
import assert from "node:assert/strict";

import {
	buildScreenshotSectionContext,
	screenshotCaptureWarnings,
	screenshotCoverage,
	screenshotImagePaths,
	screenshotSections,
} from "../src/screenshot-result.js";

function sectionScreenshot(overrides = {}) {
	return {
		path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png",
		paths: [
			"/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png",
			"/tmp/web-perception-mcp/web-perception-screenshot-1-section-2.png",
			"/tmp/web-perception-mcp/web-perception-screenshot-1-section-3.png",
		],
		metadata: {
			mode: "sections",
			sections: [
				{ index: 1, path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png", y: 0, height: 900 },
				{ index: 2, path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-2.png", y: 780, height: 900 },
				{ index: 3, path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-3.png", y: 1560, height: 900 },
			],
			start_y: 0,
			first_captured_y: 0,
			document_height: 3000,
			last_captured_bottom: 2460,
			remaining_pixels: 540,
			next_start_y: 2340,
			reached_end: false,
			truncated: true,
			max_sections_reached: true,
			max_sections: 3,
			...overrides,
		},
	};
}

test("screenshotImagePaths uses all explicit section paths", () => {
	const screenshot = sectionScreenshot();
	assert.deepEqual(screenshotImagePaths(screenshot), screenshot.paths);
	assert.deepEqual(screenshotSections(screenshot), screenshot.metadata.sections);
});

test("screenshotImagePaths falls back to metadata section paths", () => {
	const screenshot = sectionScreenshot();
	delete screenshot.paths;

	assert.deepEqual(screenshotImagePaths(screenshot), [
		"/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png",
		"/tmp/web-perception-mcp/web-perception-screenshot-1-section-2.png",
		"/tmp/web-perception-mcp/web-perception-screenshot-1-section-3.png",
	]);
});

test("screenshotImagePaths falls back to single screenshot path", () => {
	assert.deepEqual(screenshotImagePaths({ path: "/tmp/web-perception-mcp/web-perception-screenshot-1.png" }), [
		"/tmp/web-perception-mcp/web-perception-screenshot-1.png",
	]);
});

test("buildScreenshotSectionContext includes segments and continuation coverage", () => {
	const context = buildScreenshotSectionContext(sectionScreenshot());

	assert.match(context, /SCREENSHOT SEGMENTS/);
	assert.match(context, /Section 1: y=0, height=900/);
	assert.match(context, /Section 3: y=1560, height=900/);
	assert.match(context, /SECTION COVERAGE/);
	assert.match(context, /start_y=0/);
	assert.match(context, /first_captured_y=0/);
	assert.match(context, /remaining_pixels=540/);
	assert.match(context, /next_start_y=2340/);
	assert.match(context, /reached_end=false/);
	assert.match(context, /WARNING: Sections capture reached the maximum of 3 screenshots/);
});

test("screenshotCaptureWarnings reports when max_sections truncates the page", () => {
	const screenshot = sectionScreenshot();

	assert.deepEqual(screenshotCoverage(screenshot), {
		start_y: 0,
		first_captured_y: 0,
		document_height: 3000,
		last_captured_bottom: 2460,
		remaining_pixels: 540,
		next_start_y: 2340,
		reached_end: false,
		truncated: true,
		max_sections_reached: true,
		max_sections: 3,
	});
	assert.deepEqual(screenshotCaptureWarnings(screenshot), [
		"Sections capture reached the maximum of 3 screenshots before the end of the page. 540 vertical pixels were not captured.",
	]);
});

test("screenshotCaptureWarnings reports when the requested start offset was adjusted", () => {
	const screenshot = sectionScreenshot({
		start_y: 4000,
		first_captured_y: 2100,
		document_height: 3000,
		last_captured_bottom: 3000,
		remaining_pixels: 0,
		next_start_y: null,
		reached_end: true,
		truncated: false,
		max_sections_reached: false,
	});

	assert.deepEqual(screenshotCaptureWarnings(screenshot), [
		"Requested sections start_y=4000, but the browser captured first at y=2100 for the current document. Page geometry or browser scroll clamping may have changed the continuation position.",
	]);
});

test("screenshotCaptureWarnings is empty when sections reach the page end without adjustment", () => {
	const screenshot = sectionScreenshot({
		document_height: 2460,
		last_captured_bottom: 2460,
		remaining_pixels: 0,
		next_start_y: null,
		reached_end: true,
		truncated: false,
	});

	assert.deepEqual(screenshotCaptureWarnings(screenshot), []);
});
