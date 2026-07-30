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
		assert.equal(screenshot.metadata.start_y, 0);
		assert.equal(screenshot.metadata.first_captured_y, 0);
		assert.equal(screenshot.metadata.max_sections, 3);
		assert.equal(screenshot.metadata.max_sections_reached, true);
		assert.equal(screenshot.metadata.reached_end, false);
		assert.equal(screenshot.metadata.truncated, true);
		assert.equal(
			screenshot.metadata.next_start_y,
			screenshot.metadata.sections.at(-1).y + 450,
		);
		assert.equal(
			screenshot.metadata.last_captured_bottom < screenshot.metadata.document_height,
			true,
		);
		assert.equal(
			screenshot.metadata.remaining_pixels,
			screenshot.metadata.document_height - screenshot.metadata.last_captured_bottom,
		);
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

test("takeScreenshot sections can continue from a previous next_start_y", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 500 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}</style></head><body><main style="height: 3000px">Tall page</main></body></html>`);

		const first = await takeScreenshot(page, {
			mode: "sections",
			maxSections: 3,
			sectionOverlap: 50,
		});
		assert.equal(first.metadata.reached_end, false);
		assert.equal(first.metadata.next_start_y, 1350);

		const second = await takeScreenshot(page, {
			mode: "sections",
			startY: first.metadata.next_start_y,
			maxSections: 3,
			sectionOverlap: 50,
		});

		assert.equal(second.metadata.start_y, first.metadata.next_start_y);
		assert.equal(second.metadata.first_captured_y, first.metadata.next_start_y);
		assert.equal(second.metadata.sections[0].y, first.metadata.next_start_y);
		assert.equal(
			first.metadata.sections.at(-1).y + first.metadata.sections.at(-1).height - second.metadata.sections[0].y,
			50,
		);
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});

test("takeScreenshot sections clamps an unreachable start offset to the final viewport", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 500 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}</style></head><body><main style="height: 1600px">Tall page</main></body></html>`);

		const screenshot = await takeScreenshot(page, {
			mode: "sections",
			startY: 10000,
			maxSections: 3,
			sectionOverlap: 50,
		});

		assert.equal(screenshot.paths.length, 1);
		assert.equal(screenshot.metadata.start_y, 10000);
		assert.equal(screenshot.metadata.first_captured_y, 1100);
		assert.equal(screenshot.metadata.reached_end, true);
		assert.equal(screenshot.metadata.truncated, false);
		assert.equal(screenshot.metadata.remaining_pixels, 0);
		assert.equal(screenshot.metadata.next_start_y, null);
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});

test("takeScreenshot sections records the browser's actual final scroll position", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 800, height: 500 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html><html><head><style>html,body{margin:0}</style></head><body><main style="height: 1600px">Tall page</main></body></html>`);

		const screenshot = await takeScreenshot(page, {
			mode: "sections",
			maxSections: 10,
			sectionOverlap: 50,
		});

		const sections = screenshot.metadata.sections;
		const lastSection = sections.at(-1);
		const expectedLastY = Math.max(
			0,
			screenshot.metadata.dimensions.height - screenshot.metadata.viewport.height,
		);

		assert.equal(lastSection.y, expectedLastY);
		assert.equal(new Set(sections.map((section) => section.y)).size, sections.length);
		assert.equal(lastSection.y + lastSection.height >= screenshot.metadata.dimensions.height, true);
		assert.equal(screenshot.metadata.reached_end, true);
		assert.equal(screenshot.metadata.truncated, false);
		assert.equal(screenshot.metadata.remaining_pixels, 0);
		assert.equal(screenshot.metadata.next_start_y, null);
		assert.equal(
			screenshot.metadata.last_captured_bottom,
			screenshot.metadata.document_height,
		);
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});
