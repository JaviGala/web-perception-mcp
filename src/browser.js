// browser.js — Playwright browser management and screenshot capture

import { chromium } from "playwright";
import { resolve } from "node:path";
import { parseDomainList, safeLog, validateUrlResolved } from "./security.js";
import {
	defaultScreenshotPath,
	ensureDirectoryForFile,
	sectionScreenshotPath,
} from "./paths.js";

let activeBrowser = null;
let activeBrowserHeadless = null;
let activeContext = null;

function browserRequestSecurityOptions() {
	return {
		allowedDomains: parseDomainList(process.env.ALLOWED_DOMAINS),
		blockedDomains: parseDomainList(process.env.BLOCKED_DOMAINS),
		allowLocalhost: process.env.ALLOW_LOCALHOST === "true",
	};
}

function isRoutableRemoteUrl(url) {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

async function installRequestSecurity(page, options = {}) {
	const { enabled = true } = options;
	if (!enabled) return;
	const securityOptions = browserRequestSecurityOptions();
	await page.route("**/*", async (route) => {
		const request = route.request();
		const requestUrl = request.url();
		if (!isRoutableRemoteUrl(requestUrl)) {
			await route.continue();
			return;
		}

		const check = await validateUrlResolved(requestUrl, securityOptions);
		if (!check.ok) {
			safeLog("warn", "Blocked unsafe browser request", {
				url: requestUrl,
				resourceType: request.resourceType(),
				code: check.error.code,
			});
			await route.abort("blockedbyclient");
			return;
		}

		await route.continue();
	});
}

/**
 * Get or create a Playwright browser instance.
 * @param {object} options
 * @param {object} [options.viewport] - { width, height }
 * @param {number} [options.deviceScaleFactor=1]
 * @param {boolean} [options.headless=true]
 * @param {boolean} [options.secureRequests=true]
 * @returns {Promise<{browser, context, page}>}
 */
export async function launchBrowser(options = {}) {
	const {
		viewport = { width: 1440, height: 900 },
		deviceScaleFactor = 1,
		headless = true,
		secureRequests = true,
	} = options;

	if (
		activeBrowser &&
		activeBrowser.isConnected() &&
		activeBrowserHeadless === headless
	) {
		try {
			const context = await activeBrowser.newContext({
				viewport,
				deviceScaleFactor,
				serviceWorkers: "block",
			});
			activeContext = context;
			const page = await context.newPage();
			await installRequestSecurity(page, { enabled: secureRequests });
			return { browser: activeBrowser, context, page };
		} catch (err) {
			safeLog("warn", "Failed to reuse browser, launching new one", {
				error: err.message,
			});
			await closeBrowser().catch(() => {});
		}
	}

	if (activeBrowser && activeBrowser.isConnected()) {
		await closeBrowser().catch(() => {});
	}

	safeLog("info", `Launching ${headless ? "headless" : "headed"} Chromium browser`);

	const browser = await chromium.launch({
		headless,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
			"--disable-extensions",
			"--disable-background-networking",
		],
	});

	activeBrowser = browser;
	activeBrowserHeadless = headless;

	const context = await browser.newContext({
		viewport,
		deviceScaleFactor,
		serviceWorkers: "block",
	});
	activeContext = context;

	const page = await context.newPage();
	await installRequestSecurity(page, { enabled: secureRequests });

	page.setDefaultTimeout(30000);
	page.setDefaultNavigationTimeout(30000);

	return { browser, context, page };
}

/**
 * Navigate to a URL with configurable wait strategy.
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {object} options
 * @param {"domcontentloaded"|"load"|"networkidle"} [options.waitUntil="load"]
 * @param {string} [options.waitForSelector]
 * @param {number} [options.delayAfterLoadMs=0]
 * @returns {Promise<{finalUrl: string, statusCode: number}>}
 */
export async function navigatePage(page, url, options = {}) {
	const {
		waitUntil = "load",
		waitForSelector = null,
		delayAfterLoadMs = 0,
	} = options;

	safeLog("info", `Navigating to ${url}`, { waitUntil });

	let response;
	try {
		if (waitUntil === "networkidle") {
			response = await page.goto(url, { waitUntil: "load" });
			try {
				await page.waitForLoadState("networkidle", { timeout: 5000 });
			} catch (err) {
				safeLog("warn", "networkidle was not reached; continuing after load", {
					error: err.message,
				});
			}
		} else {
			response = await page.goto(url, { waitUntil });
		}
	} catch (err) {
		safeLog("error", `Navigation failed: ${err.message}`);
		throw new Error(`Navigation failed for ${url}: ${err.message}`);
	}

	if (waitForSelector) {
		try {
			await page.waitForSelector(waitForSelector, { timeout: 10000 });
		} catch {
			safeLog("warn", `Selector "${waitForSelector}" not found within timeout`);
		}
	}

	if (delayAfterLoadMs > 0) {
		await page.waitForTimeout(delayAfterLoadMs);
	}

	const finalUrl = page.url();
	const statusCode = response?.status() || 200;

	safeLog("info", "Navigation complete", { finalUrl, statusCode });

	return { finalUrl, statusCode };
}

/**
 * Take a screenshot of the current page.
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {"viewport"|"full_page"|"element"|"sections"} [options.mode="viewport"]
 * @param {string} [options.elementRef] - legacy element ref support
 * @param {string} [options.selector] - CSS selector for element screenshot
 * @param {string} [options.outputPath]
 * @param {number} [options.sectionOverlap=120]
 * @param {number} [options.maxSections=6]
 * @param {number} [options.startY=0]
 * @returns {Promise<{path: string, paths?: string[], metadata: object}>}
 */
export async function takeScreenshot(page, options = {}) {
	const {
		mode = "viewport",
		elementRef = null,
		selector = null,
		outputPath = null,
		sectionOverlap = 120,
		maxSections = 6,
		startY = 0,
	} = options;

	const timestamp = Date.now();
	const path = outputPath
		? ensureDirectoryForFile(resolve(outputPath))
		: defaultScreenshotPath(timestamp);

	const viewport = {
		width: page.viewportSize()?.width || 1440,
		height: page.viewportSize()?.height || 900,
	};

	let dimensions = viewport;
	let paths = [path];
	let sections = null;
	let coverage = null;

	if (mode === "full_page") {
		dimensions = await getPageDimensions(page, viewport);
		await page.screenshot({ path, fullPage: true });
	} else if (mode === "sections") {
		const result = await takeSectionScreenshots(page, {
			basePath: path,
			timestamp,
			viewport,
			sectionOverlap,
			maxSections,
			startY,
		});
		paths = result.paths;
		sections = result.sections;
		coverage = result.coverage;
		dimensions = result.dimensions;
	} else if (mode === "element") {
		const element = await resolveElement(page, { elementRef, selector });
		if (!element) {
			throw new Error(
				elementRef
					? `Element ref "${elementRef}" not found.`
					: `Element selector "${selector}" not found.`,
			);
		}

		const box = await element.boundingBox();
		if (!box) {
			throw new Error(
				elementRef
					? `Element ref "${elementRef}" is not visible.`
					: `Element selector "${selector}" is not visible.`,
			);
		}

		dimensions = {
			width: Math.round(box.width),
			height: Math.round(box.height),
		};
		await element.screenshot({ path });
	} else {
		await page.screenshot({ path });
	}

	safeLog("info", "Screenshot saved", {
		path,
		mode,
		dimensions,
		count: paths.length,
	});

	return {
		path: paths[0],
		paths,
		metadata: {
			viewport,
			fullPage: mode === "full_page",
			dimensions,
			deviceScaleFactor: 1,
			mode,
			sections,
			...(coverage || {}),
		},
	};
}

async function getPageDimensions(page, fallbackViewport) {
	try {
		return await page.evaluate(() => ({
			width: Math.max(
				document.documentElement.scrollWidth,
				document.body?.scrollWidth || 0,
				window.innerWidth,
			),
			height: Math.max(
				document.documentElement.scrollHeight,
				document.body?.scrollHeight || 0,
				window.innerHeight,
			),
		}));
	} catch {
		return fallbackViewport;
	}
}

async function resolveElement(page, { elementRef, selector }) {
	if (elementRef) {
		const handle = await page.evaluateHandle((ref) => {
			return Array.from(document.querySelectorAll("*")).find(
				(el) => el.getAttribute("data-wm-ref") === ref,
			);
		}, elementRef);

		const element = handle.asElement();
		if (element) return element;
		await handle.dispose().catch(() => {});
	}

	if (selector) {
		const locator = page.locator(selector).first();
		if ((await locator.count()) > 0) return locator;
	}

	return null;
}

async function takeSectionScreenshots(page, options) {
	const {
		basePath = null,
		timestamp,
		viewport,
		sectionOverlap,
		maxSections,
		startY = 0,
	} = options;

	const dimensions = await getPageDimensions(page, viewport);
	const originalScroll = await page.evaluate(() => ({
		x: window.scrollX,
		y: window.scrollY,
	}));
	const step = Math.max(1, viewport.height - sectionOverlap);
	const normalizedStartY = Number.isFinite(startY) ? Math.max(0, Math.trunc(startY)) : 0;
	const maxScrollY = Math.max(0, dimensions.height - viewport.height);
	const effectiveStartY = Math.min(normalizedStartY, maxScrollY);
	const paths = [];
	const sections = [];
	let previousScrollY = null;

	for (
		let requestedY = effectiveStartY, index = 0;
		requestedY < dimensions.height && index < maxSections;
		requestedY += step, index++
	) {
		await page.evaluate((scrollY) => window.scrollTo(0, scrollY), requestedY);
		await page.waitForTimeout(150);

		const actualY = await page.evaluate(() => window.scrollY);
		if (actualY === previousScrollY) break;

		const sectionPath = sectionScreenshotPath(basePath, timestamp, index + 1);

		await page.screenshot({ path: sectionPath, fullPage: false });
		paths.push(sectionPath);
		sections.push({
			index: index + 1,
			path: sectionPath,
			y: actualY,
			width: viewport.width,
			height: viewport.height,
		});
		previousScrollY = actualY;

		if (actualY + viewport.height >= dimensions.height) break;
	}

	const finalDimensions = await getPageDimensions(page, dimensions);
	const firstSection = sections[0] || null;
	const lastSection = sections.at(-1);
	const lastCapturedBottom = lastSection
		? Math.min(finalDimensions.height, lastSection.y + lastSection.height)
		: 0;
	const reachedEnd = lastCapturedBottom >= finalDimensions.height;
	const coverage = {
		start_y: normalizedStartY,
		first_captured_y: firstSection?.y ?? null,
		document_height: finalDimensions.height,
		last_captured_bottom: lastCapturedBottom,
		remaining_pixels: Math.max(0, finalDimensions.height - lastCapturedBottom),
		next_start_y: reachedEnd || !lastSection ? null : lastSection.y + step,
		reached_end: reachedEnd,
		truncated: !reachedEnd,
		max_sections_reached: sections.length >= maxSections,
		max_sections: maxSections,
	};

	await page.evaluate(({ x, y }) => window.scrollTo(x, y), originalScroll);

	return { paths, sections, dimensions: finalDimensions, coverage };
}

export async function closeBrowser() {
	if (activeContext) {
		await activeContext.close().catch(() => {});
		activeContext = null;
	}
	if (activeBrowser) {
		safeLog("info", "Closing browser");
		await activeBrowser.close().catch(() => {});
		activeBrowser = null;
		activeBrowserHeadless = null;
	}
}

export function isBrowserActive() {
	return activeBrowser !== null && activeBrowser.isConnected();
}
