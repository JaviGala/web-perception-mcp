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
			document_height: 3000,
			last_captured_bottom: 2460,
			remaining_pixels: 540,
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

test("buildScreenshotSectionContext includes segments and incomplete coverage", () => {
	const context = buildScreenshotSectionContext(sectionScreenshot());

	assert.match(context, /SCREENSHOT SEGMENTS/);
	assert.match(context, /Section 1: y=0, height=900/);
	assert.match(context, /Section 3: y=1560, height=900/);
	assert.match(context, /SECTION COVERAGE/);
	assert.match(context, /remaining_pixels=540/);
	assert.match(context, /reached_end=false/);
	assert.match(context, /WARNING: Sections capture reached the maximum of 3 screenshots/);
});

test("screenshotCaptureWarnings reports when max_sections truncates the page", () => {
	const screenshot = sectionScreenshot();

	assert.deepEqual(screenshotCoverage(screenshot), {
		document_height: 3000,
		last_captured_bottom: 2460,
		remaining_pixels: 540,
		reached_end: false,
		truncated: true,
		max_sections_reached: true,
		max_sections: 3,
	});
	assert.deepEqual(screenshotCaptureWarnings(screenshot), [
		"Sections capture reached the maximum of 3 screenshots before the end of the page. 540 vertical pixels were not captured.",
	]);
});

test("screenshotCaptureWarnings is empty when sections reach the page end", () => {
	const screenshot = sectionScreenshot({
		document_height: 2460,
		last_captured_bottom: 2460,
		remaining_pixels: 0,
		reached_end: true,
		truncated: false,
	});

	assert.deepEqual(screenshotCaptureWarnings(screenshot), []);
});
