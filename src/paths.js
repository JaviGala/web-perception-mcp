// paths.js — cross-platform local paths used by screenshot capture and image validation

import { lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

export const SCREENSHOT_FILE_PREFIX = "web-perception-screenshot-";

export function appTempDir() {
	return resolve(process.env.WEB_PERCEPTION_TEMP_DIR || join(tmpdir(), "web-perception-mcp"));
}

export function screenshotOutputDir() {
	return resolve(process.env.SCREENSHOT_OUTPUT_DIR || appTempDir());
}

export function ensureDirectory(dirPath) {
	mkdirSync(dirPath, { recursive: true });
	return dirPath;
}

export function ensureDirectoryForFile(filePath) {
	ensureDirectory(dirname(filePath));
	return filePath;
}

export function ensureScreenshotOutputDir() {
	return ensureDirectory(screenshotOutputDir());
}

export function isInsideRoot(filePath, root) {
	const relativePath = relative(root, filePath);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function screenshotRetentionMs() {
	const minutes = Number(process.env.SCREENSHOT_RETENTION_MINUTES || "1440");
	if (!Number.isFinite(minutes) || minutes <= 0) return null;
	return minutes * 60 * 1000;
}

export function cleanupOldScreenshots(dir = screenshotOutputDir()) {
	if (process.env.SCREENSHOT_AUTO_CLEANUP === "false") return;
	const retentionMs = screenshotRetentionMs();
	if (!retentionMs) return;

	const cutoff = Date.now() - retentionMs;
	try {
		for (const entry of readdirSync(dir)) {
			if (!entry.startsWith(SCREENSHOT_FILE_PREFIX) || !entry.endsWith(".png")) continue;
			const filePath = join(dir, entry);
			const stats = lstatSync(filePath);
			if (stats.isFile() && stats.mtimeMs < cutoff) {
				rmSync(filePath, { force: true });
			}
		}
	} catch {
		// Cleanup is best-effort. Capture should still work if temp cleanup fails.
	}
}

export function defaultScreenshotPath(timestamp = Date.now()) {
	const dir = ensureScreenshotOutputDir();
	cleanupOldScreenshots(dir);
	return join(dir, `${SCREENSHOT_FILE_PREFIX}${timestamp}.png`);
}

export function sectionScreenshotPath(basePath, timestamp, index) {
	if (basePath) {
		const parsed = parse(basePath);
		const extension = parsed.ext || ".png";
		return ensureDirectoryForFile(join(parsed.dir, `${parsed.name}-section-${index}${extension}`));
	}

	const dir = ensureScreenshotOutputDir();
	return join(dir, `${SCREENSHOT_FILE_PREFIX}${timestamp}-section-${index}.png`);
}
