import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..");

test("MCP server version matches package.json", () => {
	const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
	const serverSource = readFileSync(resolve(rootDir, "src", "server.js"), "utf8");
	const match = serverSource.match(
		/name:\s*"web-perception-mcp",\s*version:\s*"([^"]+)"/s,
	);

	assert.ok(match, "Could not find the MCP server version in src/server.js");
	assert.equal(match[1], packageJson.version);
});
