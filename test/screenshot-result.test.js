import test from "node:test";
import assert from "node:assert/strict";

import {
	buildScreenshotSectionContext,
	screenshotImagePaths,
	screenshotSections,
} from "../src/screenshot-result.js";

test("screenshotImagePaths uses all explicit section paths", () => {
	const screenshot = {
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
		},
	};

	assert.deepEqual(screenshotImagePaths(screenshot), screenshot.paths);
	assert.deepEqual(screenshotSections(screenshot), screenshot.metadata.sections);
});

test("screenshotImagePaths falls back to metadata section paths", () => {
	const screenshot = {
		path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png",
		metadata: {
			mode: "sections",
			sections: [
				{ index: 1, path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png", y: 0, height: 900 },
				{ index: 2, path: "/tmp/web-perception-mcp/web-perception-screenshot-1-section-2.png", y: 780, height: 900 },
			],
		},
	};

	assert.deepEqual(screenshotImagePaths(screenshot), [
		"/tmp/web-perception-mcp/web-perception-screenshot-1-section-1.png",
		"/tmp/web-perception-mcp/web-perception-screenshot-1-section-2.png",
	]);
});

test("screenshotImagePaths falls back to single screenshot path", () => {
	assert.deepEqual(screenshotImagePaths({ path: "/tmp/web-perception-mcp/web-perception-screenshot-1.png" }), [
		"/tmp/web-perception-mcp/web-perception-screenshot-1.png",
	]);
});

test("buildScreenshotSectionContext includes all sections", () => {
	const context = buildScreenshotSectionContext({
		metadata: {
			sections: [
				{ index: 1, path: "/tmp/one.png", y: 0, height: 900 },
				{ index: 2, path: "/tmp/two.png", y: 780, height: 900 },
			],
		},
	});

	assert.match(context, /SCREENSHOT SEGMENTS/);
	assert.match(context, /Section 1: y=0, height=900, path=\/tmp\/one\.png/);
	assert.match(context, /Section 2: y=780, height=900, path=\/tmp\/two\.png/);
});
