import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { launchBrowser, takeScreenshot, closeBrowser } from "../src/browser.js";
import { screenshotImagePaths } from "../src/screenshot-result.js";

test("screenshotImagePaths returns every captured section path", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 500 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><body><main style="height: 1600px">Tall page</main></body>`);

		const screenshot = await takeScreenshot(page, {
			mode: "sections",
			maxSections: 3,
			sectionOverlap: 50,
		});
		const imagePaths = screenshotImagePaths(screenshot);

		assert.equal(imagePaths.length, 3);
		assert.deepEqual(imagePaths, screenshot.paths);
		assert.deepEqual(imagePaths, screenshot.metadata.sections.map((section) => section.path));
		for (const imagePath of imagePaths) {
			assert.equal(existsSync(imagePath), true);
		}
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});
