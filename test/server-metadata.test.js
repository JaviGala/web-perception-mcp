import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..");
const serverPath = resolve(rootDir, "src", "server.js");

function startMcpServer(t) {
	const child = spawn(process.execPath, [serverPath], {
		cwd: rootDir,
		stdio: ["pipe", "pipe", "pipe"],
	});

	let stdoutBuffer = "";
	let stderr = "";
	let nextId = 1;
	const pending = new Map();

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});

	child.stdout.on("data", (chunk) => {
		stdoutBuffer += chunk;
		while (stdoutBuffer.includes("\n")) {
			const newlineIndex = stdoutBuffer.indexOf("\n");
			const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			if (!line) continue;

			let message;
			try {
				message = JSON.parse(line);
			} catch (error) {
				for (const { reject } of pending.values()) reject(error);
				pending.clear();
				continue;
			}

			if (message.id === undefined) continue;
			const request = pending.get(message.id);
			if (!request) continue;
			pending.delete(message.id);
			clearTimeout(request.timeout);
			if (message.error) request.reject(new Error(JSON.stringify(message.error)));
			else request.resolve(message.result);
		}
	});

	child.on("exit", (code, signal) => {
		if (pending.size === 0) return;
		const error = new Error(
			`MCP server exited before responding (code=${code}, signal=${signal}). stderr: ${stderr}`,
		);
		for (const { reject, timeout } of pending.values()) {
			clearTimeout(timeout);
			reject(error);
		}
		pending.clear();
	});

	function request(method, params = {}) {
		const id = nextId++;
		return new Promise((resolvePromise, reject) => {
			const timeout = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr}`));
			}, 5000);
			pending.set(id, { resolve: resolvePromise, reject, timeout });
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	function notify(method, params = {}) {
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	t.after(() => {
		for (const { timeout } of pending.values()) clearTimeout(timeout);
		pending.clear();
		child.stdin.end();
		child.kill();
	});

	return { request, notify };
}

function findTool(tools, name) {
	const tool = tools.find((candidate) => candidate.name === name);
	assert.ok(tool, `Expected tool ${name}`);
	return tool;
}

test("MCP initialization and tool metadata explain how to select the visual tools", async (t) => {
	const client = startMcpServer(t);
	const initialized = await client.request("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "metadata-contract-test", version: "1.0.0" },
	});

	assert.equal(initialized.serverInfo.name, "web-perception-mcp");
	assert.equal(initialized.serverInfo.version, "0.1.3");
	assert.ok(initialized.capabilities.tools);
	assert.equal(typeof initialized.instructions, "string");

	const instructions = initialized.instructions.toLowerCase();
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

	client.notify("notifications/initialized");
	const listed = await client.request("tools/list");
	const tools = listed.tools;

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

	const analyzePage = findTool(tools, "analyze_page_screenshot");
	assert.match(analyzePage.description, /rendered appearance/i);
	assert.match(analyzePage.description, /layout|visual hierarchy/i);
	assert.match(analyzePage.description, /primarily textual retrieval/i);
	assert.deepEqual(analyzePage.inputSchema.required, ["url", "prompt"]);

	for (const tool of tools) {
		assert.equal(tool.inputSchema.type, "object");
		assert.ok(tool.description.length < 900, `${tool.name} description should remain concise`);
	}
});
