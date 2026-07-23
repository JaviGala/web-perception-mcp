// screenshot-result.js — helpers for normalising screenshot capture results

export function screenshotSections(screenshot) {
	if (Array.isArray(screenshot?.metadata?.sections)) return screenshot.metadata.sections;
	if (Array.isArray(screenshot?.sections)) return screenshot.sections;
	return [];
}

export function screenshotImagePaths(screenshot) {
	const paths = Array.isArray(screenshot?.paths)
		? screenshot.paths.filter(Boolean)
		: [];
	if (paths.length > 0) return paths;

	const sectionPaths = screenshotSections(screenshot)
		.map((section) => section?.path)
		.filter(Boolean);
	if (sectionPaths.length > 0) return sectionPaths;

	return screenshot?.path ? [screenshot.path] : [];
}

export function screenshotCoverage(screenshot) {
	const metadata = screenshot?.metadata || screenshot;
	if (metadata?.mode !== "sections" || typeof metadata.reached_end !== "boolean") return null;

	return {
		document_height: metadata.document_height,
		last_captured_bottom: metadata.last_captured_bottom,
		remaining_pixels: metadata.remaining_pixels,
		reached_end: metadata.reached_end,
		truncated: metadata.truncated,
		max_sections_reached: metadata.max_sections_reached,
		max_sections: metadata.max_sections,
	};
}

export function screenshotCaptureWarnings(screenshot) {
	const coverage = screenshotCoverage(screenshot);
	if (!coverage?.truncated) return [];

	if (coverage.max_sections_reached) {
		return [
			`Sections capture reached the maximum of ${coverage.max_sections} screenshots before the end of the page. ${coverage.remaining_pixels} vertical pixels were not captured.`,
		];
	}

	return ["Sections capture ended before reaching the end of the page."];
}

export function buildScreenshotSectionContext(screenshot) {
	const sections = screenshotSections(screenshot);
	if (sections.length === 0) return "";

	const lines = ["", "SCREENSHOT SEGMENTS:"];
	for (const section of sections) {
		lines.push(
			`- Section ${section.index}: y=${section.y}, height=${section.height}, path=${section.path}`,
		);
	}

	const coverage = screenshotCoverage(screenshot);
	if (coverage) {
		lines.push("", "SECTION COVERAGE:");
		lines.push(
			`- document_height=${coverage.document_height}, last_captured_bottom=${coverage.last_captured_bottom}, remaining_pixels=${coverage.remaining_pixels}, reached_end=${coverage.reached_end}, truncated=${coverage.truncated}, max_sections_reached=${coverage.max_sections_reached}`,
		);
		for (const warning of screenshotCaptureWarnings(screenshot)) {
			lines.push(`- WARNING: ${warning}`);
		}
	}

	return lines.join("\n");
}
