import test from "node:test";
import assert from "node:assert/strict";

import { parseVisualResult } from "../src/vision.js";

const findings = {
	summary: "Excalidraw is visible.",
	observations: ["A drawing toolbar is shown."],
	interpretations: ["The page is ready for diagram editing."],
	uncertainty: [],
};

test("parseVisualResult accepts direct JSON", () => {
	const raw = JSON.stringify(findings);
	const result = parseVisualResult(raw);

	assert.equal(result.usedFallback, false);
	assert.deepEqual(result.findings, findings);
	assert.equal(result.raw, raw);
	assert.equal(result.warning, undefined);
});

test("parseVisualResult accepts fenced JSON with trailing whitespace", () => {
	const raw = `\`\`\`json\n${JSON.stringify(findings, null, 2)}\n\`\`\`\n`;
	const result = parseVisualResult(raw);

	assert.equal(result.usedFallback, false);
	assert.deepEqual(result.findings, findings);
	assert.equal(result.raw, raw);
	assert.equal(result.warning, undefined);
});
