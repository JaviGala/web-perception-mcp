import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..");
const serverPath = resolve(rootDir, "src", "server.js");

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
	assert.equal(serverVersion?.version, "0.1.3");
	assert.ok(client.getServerCapabilities()?.tools);

	const serverInstructions = client.getInstructions();
	assert.equal(typeof serverInstructions, "string");
	const instructions = serverInstructions.toLowerCase();
	for (const expected of [
		"analyze_image",
		"analyze_page_screenshot",
		"capture_page_screenshot",
		"local image",
		"rendered appearance",
		"without visual interpretation",
		"textual webpage",
		"fetch",
	]) {
		assert.ok(instructions.includes(expected), `Instructions should mention ${expected}`);
	}

	const { tools } = await client.listTools();
	assert.deepEqual(
		tools.map((tool) => tool.name).sort(),
		["analyze_image", "analyze_page_screenshot", "capture_page_screenshot"],
	);

	const analyzeImage = findTool(tools, "analyze_image");
	assert.match(analyzeImage.description, /existing local image/i);
	assert.match(analyzeImage.description, /do not use for urls/i);
	assert.deepEqual(analyzeImage.inputSchema.required, ["image_path", "prompt"]);
	assert.match(analyzeImage.inputSchema.properties.image_path.description, /allowed_image_dirs/i);

	const capturePage = findTool(tools, "capture_page_screenshot");
	assert.match(capturePage.description, /without calling the vision provider/i);
	assert.match(capturePage.description, /use analyze_page_screenshot instead/i);
	assert.match(capturePage.description, /textual fetch or scraping/i);
	assert.deepEqual(capturePage.inputSchema.required, ["url"]);
	assert.equal(capturePage.inputSchema.properties.include_open_command.default, false);
	assert.match(
		capturePage.inputSchema.properties.include_open_command.description,
		/only when the user explicitly asks/i,
	);

	const analyzePage = findTool(tools, "analyze_page_screenshot");
	assert.match(analyzePage.description, /visual appearance/i);
	assert.match(analyzePage.description, /layout|visual hierarchy/i);
	assert.match(analyzePage.description, /primarily textual retrieval/i);
	assert.deepEqual(analyzePage.inputSchema.required, ["url", "prompt"]);

	for (const tool of tools) {
		assert.equal(tool.inputSchema.type, "object");
		assert.ok(tool.description.length < 900, `${tool.name} description should remain concise`);
	}
});
