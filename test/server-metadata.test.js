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
		"visual interpretation of rendered webpages",
		"fetch or scraping",
		"viewport by default",
		"ordered long-page",
		"coverage metadata and warnings",
		"untrusted data",
		"provider analysis",
		"network",
		"write screenshots",
		"configured provider",
		"consume quota",
		"do not modify source images or target webpages",
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
	assert.match(modeDescription, /check coverage metadata and warnings/i);
	assert.match(analyzePage.inputSchema.properties.max_sections.description, /returns a warning/i);

	// Project-level context-budget guardrails, not MCP protocol limits.
	assert.ok(serverInstructions.length < 900, "Server instructions should remain concise");
	assert.ok(modeDescription.length < 450, "Screenshot mode guidance should remain concise");
	for (const tool of tools) {
		assert.equal(tool.inputSchema.type, "object");
		assert.ok(tool.description.length < 600, `${tool.name} description should remain concise`);
	}
});
