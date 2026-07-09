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

export function buildScreenshotSectionContext(screenshot) {
	const sections = screenshotSections(screenshot);
	if (sections.length === 0) return "";

	const lines = ["", "SCREENSHOT SEGMENTS:"];
	for (const section of sections) {
		lines.push(
			`- Section ${section.index}: y=${section.y}, height=${section.height}, path=${section.path}`,
		);
	}
	return lines.join("\n");
}
