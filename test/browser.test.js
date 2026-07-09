import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { launchBrowser, takeScreenshot, closeBrowser } from "../src/browser.js";
import { appTempDir } from "../src/paths.js";

test("takeScreenshot full_page captures real page dimensions", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 600 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><body><main style="height: 1800px">Tall page</main></body>`);

		const screenshot = await takeScreenshot(page, { mode: "full_page" });
		assert.equal(existsSync(screenshot.path), true);
		assert.equal(screenshot.metadata.mode, "full_page");
		assert.equal(screenshot.metadata.dimensions.width >= 800, true);
		assert.equal(screenshot.metadata.dimensions.height >= 1800, true);
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});

test("takeScreenshot uses an app-owned OS temp directory by default", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 600 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><body><main>Temp path check</main></body>`);

		const screenshot = await takeScreenshot(page, { mode: "viewport" });
		assert.equal(existsSync(screenshot.path), true);
		assert.equal(screenshot.path.startsWith(appTempDir()), true);
		assert.equal(appTempDir().startsWith(tmpdir()) || appTempDir() === join(tmpdir(), "web-perception-mcp"), true);
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});

test("takeScreenshot element captures a CSS selector", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 600 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><body><button data-testid="continue" style="width: 160px; height: 48px">Continue</button></body>`);

		const screenshot = await takeScreenshot(page, {
			mode: "element",
			selector: "[data-testid='continue']",
		});
		assert.equal(existsSync(screenshot.path), true);
		assert.equal(screenshot.metadata.mode, "element");
		assert.equal(screenshot.metadata.dimensions.width > 0, true);
		assert.equal(screenshot.metadata.dimensions.height > 0, true);
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});

test("takeScreenshot sections returns multiple ordered screenshots", async () => {
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

		assert.equal(screenshot.metadata.mode, "sections");
		assert.equal(screenshot.paths.length, 3);
		assert.equal(screenshot.metadata.sections.length, 3);
		assert.equal(screenshot.metadata.sections[0].index, 1);
		assert.equal(screenshot.metadata.sections[1].y > screenshot.metadata.sections[0].y, true);
		for (const path of screenshot.paths) {
			assert.equal(existsSync(path), true);
		}
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});
