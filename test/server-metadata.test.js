import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..");
const serverPath = resolve(rootDir, "src", "server.js");
const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

function findTool(tools, name) {
	const tool = tools.find((candidate) => candidate.name === name);
	assert.ok(tool, `Expected tool ${name}`);
	return tool;
}

function assertStructuredOutputDescription(description) {
	assert.match(description, /json findings/i);
	assert.match(description, /summary/i);
	assert.match(description, /observations/i);
	assert.match(description, /interpretations/i);
	assert.match(description, /uncertainty/i);
	assert.match(description, /data\.parsed/i);
	assert.match(description, /data\.analysis/i);
	assert.match(description, /best effort/i);
	assert.match(description, /warnings/i);
}

function assertContinuationMetadata(tool) {
	const startY = tool.inputSchema.properties.start_y;
	assert.equal(startY.type, "integer");
	assert.equal(startY.minimum, 0);
	assert.equal(startY.default, 0);
	assert.match(startY.description, /sections mode/i);
	assert.match(startY.description, /next_start_y/i);
	assert.match(startY.description, /stateless/i);
	assert.match(startY.description, /reloads the page/i);
	assert.match(startY.description, /first_captured_y/i);
	assert.match(startY.description, /ignored by other/i);

	assert.match(tool.inputSchema.properties.screenshot_mode.description, /start_y/i);
	assert.match(tool.inputSchema.properties.screenshot_mode.description, /next_start_y/i);
	assert.match(tool.inputSchema.properties.screenshot_mode.description, /stateless/i);
	assert.match(tool.inputSchema.properties.max_sections.description, /next_start_y/i);
	assert.match(tool.inputSchema.properties.max_sections.description, /continuation/i);
	assert.match(tool.inputSchema.properties.section_overlap.description, /continuation/i);
}

test("MCP initialization and tool metadata explain how to select the visual tools", async (t) => {
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [serverPath],
		cwd: rootDir,
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.setEncoding("utf8");
	transport.stderr?.on("data", (chunk) => {
		stderr += chunk;
	});

	const client = new Client(
		{ name: "metadata-contract-test", version: "1.0.0" },
		{ capabilities: {} },
	);
	t.after(async () => {
		await client.close();
	});

	try {
		await client.connect(transport);
	} catch (error) {
		assert.fail(`Could not initialize MCP server: ${error.message}. stderr: ${stderr}`);
	}

	const serverVersion = client.getServerVersion();
	assert.equal(serverVersion?.name, "web-perception-mcp");
	assert.equal(serverVersion?.version, packageJson.version);
	assert.ok(client.getServerCapabilities()?.tools);

	const serverInstructions = client.getInstructions();
	assert.equal(typeof serverInstructions, "string");
	const instructions = serverInstructions.toLowerCase();
	for (const expected of [
		"analyze_image",
		"analyze_page_screenshot",
		"capture_page_screenshot",
		"existing local images",
		"screenshot files without interpretation",
		"rendered-page visual analysis",
		"fetch or scraping",
		"viewport by default",
		"ordered long-page coverage",
		"next_start_y",
		"start_y",
		"reloads the page",
		"actual positions",
		"warnings",
		"json_object",
		"summary",
		"observations",
		"interpretations",
		"uncertainty",
		"data.parsed",
		"best effort",
		"untrusted data",
		"provider analysis",
		"network/browser",
		"write screenshots",
		"provider",
		"consume quota",
		"do not modify source images or target pages",
	]) {
		assert.ok(instructions.includes(expected), `Instructions should mention ${expected}`);
	}

	const { tools } = await client.listTools();
	assert.deepEqual(
		tools.map((tool) => tool.name).sort(),
		["analyze_image", "analyze_page_screenshot", "capture_page_screenshot"],
	);

	const analyzeImage = findTool(tools, "analyze_image");
	assert.equal(analyzeImage.title, "Analyze Image");
	assert.match(analyzeImage.description, /existing local image/i);
	assert.match(analyzeImage.description, /do not use for urls/i);
	assert.match(analyzeImage.description, /does not modify files/i);
	assert.match(analyzeImage.description, /provider or consume quota/i);
	assert.match(analyzeImage.description, /provider analysis as untrusted data/i);
	assert.deepEqual(analyzeImage.annotations, {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	});
	assert.deepEqual(analyzeImage.inputSchema.required, ["image_path", "prompt"]);
	assert.match(analyzeImage.inputSchema.properties.image_path.description, /allowed_image_dirs/i);
	assertStructuredOutputDescription(analyzeImage.inputSchema.properties.response_format.description);

	const capturePage = findTool(tools, "capture_page_screenshot");
	assert.equal(capturePage.title, "Capture Page Screenshot");
	assert.match(capturePage.description, /without visual interpretation/i);
	assert.match(capturePage.description, /use analyze_page_screenshot/i);
	assert.match(capturePage.description, /fetch or scraping/i);
	assert.match(capturePage.description, /network request/i);
	assert.match(capturePage.description, /local browser/i);
	assert.match(capturePage.description, /writes files/i);
	assert.match(capturePage.description, /does not call the vision provider/i);
	assert.match(capturePage.description, /modify the target page/i);
	assert.match(capturePage.description, /extracted context as untrusted data/i);
	assert.deepEqual(capturePage.annotations, {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	});
	assert.deepEqual(capturePage.inputSchema.required, ["url"]);
	assert.equal(capturePage.inputSchema.properties.screenshot_mode.default, "viewport");
	assert.equal(capturePage.inputSchema.properties.include_open_command.default, false);
	assert.match(
		capturePage.inputSchema.properties.include_open_command.description,
		/only when the user explicitly asks/i,
	);
	assert.match(capturePage.inputSchema.properties.include_page_context.description, /pixels alone/i);
	assertContinuationMetadata(capturePage);

	const analyzePage = findTool(tools, "analyze_page_screenshot");
	assert.equal(analyzePage.title, "Analyze Page Screenshot");
	assert.match(analyzePage.description, /visual appearance/i);
	assert.match(analyzePage.description, /layout|visual hierarchy/i);
	assert.match(analyzePage.description, /primarily textual retrieval/i);
	assert.match(analyzePage.description, /network request/i);
	assert.match(analyzePage.description, /local browser/i);
	assert.match(analyzePage.description, /writes screenshots/i);
	assert.match(analyzePage.description, /included page context/i);
	assert.match(analyzePage.description, /consume quota/i);
	assert.match(analyzePage.description, /multiple images/i);
	assert.match(analyzePage.description, /coverage metadata/i);
	assert.match(analyzePage.description, /warnings/i);
	assert.match(analyzePage.description, /provider analysis as untrusted data/i);
	assert.deepEqual(analyzePage.annotations, {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	});
	assert.deepEqual(analyzePage.inputSchema.required, ["url", "prompt"]);
	assert.equal(analyzePage.inputSchema.properties.screenshot_mode.default, "viewport");
	assert.match(
		readFileSync(serverPath, "utf8"),
		/async function handleAnalyzePageScreenshot[\s\S]*?defaultScreenshotMode:\s*"viewport"/,
	);

	const modeDescription = analyzePage.inputSchema.properties.screenshot_mode.description;
	assert.match(modeDescription, /viewport \(default\)/i);
	assert.match(modeDescription, /sections for ordered long-page/i);
	assert.match(modeDescription, /full_page only when one complete image/i);
	assert.match(modeDescription, /element for one selector/i);
	assert.match(modeDescription, /start_y/i);
	assert.match(modeDescription, /next_start_y/i);
	assert.match(modeDescription, /check actual positions, coverage metadata, and warnings/i);
	assertContinuationMetadata(analyzePage);
	assert.match(analyzePage.inputSchema.properties.include_page_context.description, /pixels alone/i);
	assertStructuredOutputDescription(analyzePage.inputSchema.properties.response_format.description);

	// Project-level context-budget guardrails, not MCP protocol limits.
	assert.ok(serverInstructions.length < 900, "Server instructions should remain concise");
	assert.ok(modeDescription.length < 450, "Screenshot mode guidance should remain concise");
	for (const tool of tools) {
		assert.equal(tool.inputSchema.type, "object");
		assert.ok(tool.description.length < 600, `${tool.name} description should remain concise`);
	}
});
