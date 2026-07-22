# Cline setup guide

This guide shows one tested way to use `web-perception-mcp` from Cline as a local `stdio` MCP server.

The MCP gives a non-visual coding agent access to local image analysis, rendered webpage capture, and webpage screenshot analysis through a configurable vision-capable model.

## Before installing

> [!IMPORTANT]
> Webpage capture requires Chromium Headless Shell managed by Playwright. The browser download is distinct from `npm install`. Using `--only-shell` avoids downloading the separate full Chromium build; the exact size varies by Playwright version and operating system.

`analyze_image` does not launch Chromium. The two analysis tools send images, prompts, and any included compact page context to the configured vision provider. `capture_page_screenshot` renders pages locally and does not call that provider.

## Requirements

- Node.js 18 or newer.
- Cline installed in VS Code or another supported IDE.
- An API key for a compatible vision provider.
- Playwright Chromium Headless Shell for webpage screenshots.
- A local clone of this repository.

## Install the server locally

```bash
git clone https://github.com/JaviGala/web-perception-mcp.git
cd web-perception-mcp
npm install
npx playwright install --only-shell chromium
cp .env.example .env
npm test
```

Edit `.env` and set the provider values:

```env
VISION_API_KEY=your_key_here
VISION_BASE_URL=https://your-provider.example/v1
VISION_MODEL=your-vision-model
```

For a local setup, keeping credentials only in this ignored `.env` file is recommended. Avoid duplicating provider values in both `.env` and the Cline MCP configuration. Non-empty environment variables supplied by the MCP client or inherited by the process take precedence over matching values in `.env`, which can make stale configuration harder to diagnose.

Git ignoring `.env` prevents accidental commits but does not prevent Cline or another local tool from reading it. Keep `.env` and credential-bearing variants in `.clineignore` to reduce automatic context and search exposure. This is not a security boundary: do not ask Cline to open, search, copy, or print credential files.

## Add the MCP server in Cline

In the Cline panel:

1. Open **MCP Servers**.
2. Open the **Configure** tab.
3. Click **Configure MCP Servers**.
4. Add or update an entry under `mcpServers`.
5. Save the JSON file.
6. Restart or reload the MCP server from Cline.

Use an absolute path for the server script in `args` and, when provided, an absolute `cwd`. The `command` can remain `node` when Node.js is available through `PATH`; use an absolute Node.js path only when Cline cannot resolve it. Do not use `~` or relative paths for `args` or `cwd`.

```json
{
  "mcpServers": {
    "web-perception": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/web-perception-mcp/src/server.js"],
      "cwd": "/absolute/path/to/web-perception-mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

The server locates `.env` relative to `src/server.js`, so the `args` path must point to the intended clone. Setting `cwd` to the repository root keeps project-relative behaviour, default image roots, and diagnostics aligned with that clone.

On Windows, use forward slashes or escaped backslashes in JSON strings:

```json
{
  "command": "node",
  "args": ["C:/Users/you/projects/web-perception-mcp/src/server.js"],
  "cwd": "C:/Users/you/projects/web-perception-mcp"
}
```

## Optional nanoGPT configuration

For a nanoGPT subscription endpoint with Minimax, the relevant `.env` values can look like this:

```env
VISION_API_KEY=your-nanogpt-key-here
VISION_BASE_URL=https://nano-gpt.com/api/subscription/v1
VISION_MODEL=minimax/minimax-m3
VISION_PROVIDER_NAME=nanoGPT
VISION_TEMPERATURE=0.3
VISION_MAX_TOKENS=2000
```

Do not commit `.env` or real API keys to the repository.

## Check 1: connection and capture without vision cost

This explicit check confirms that Cline can see and call the server. Ask:

```text
Use the web-perception MCP server to save a viewport screenshot of https://example.com.
Include compact page context and an open command. Do not analyse the screenshot.
```

Expected result:

- Cline selects `capture_page_screenshot`.
- The tool returns `ok: true`.
- The page URL is `https://example.com/`.
- A local screenshot path or `file://` URL is returned.
- `page_health.capture_status` is `ok`.
- No vision-provider call is made.

This still launches Playwright Chromium locally and can use CPU, memory, network access, and disk space.

## Check 2: automatic tool discovery

Start a fresh conversation and do not name the MCP or tool. Ask:

```text
Inspect https://example.com as rendered and describe its visual hierarchy.
Base the answer on its visual appearance, not only its text or HTML.
```

Expected result:

- Cline selects `analyze_page_screenshot` from its tool metadata.
- The proposed arguments include the URL and a relevant visual-analysis prompt.
- The screenshot is sent to the configured vision provider after approval.

Tool names may be prefixed by the configured server identifier in the Cline interface. The model should use the exact exposed name rather than reconstructing it.

## Check 3: textual negative control

Start another fresh conversation and ask:

```text
Fetch and summarise the main text from https://example.com.
```

When an ordinary fetch tool is available, Cline should not select a web-perception visual tool for this primarily textual request.

The wider release check, including local-image and canvas cases, is documented in [`model-discovery-check.md`](./model-discovery-check.md).

## Check 4: analyse a local image

Use a local image path inside an allowed directory. By default, the server accepts images from the project directory, the app temporary directory, the screenshot output directory, and the operating-system temporary directory.

```text
Analyse the visible UI and any obvious usability issues in /absolute/path/to/image.png.
```

Expected result:

- Cline selects `analyze_image`.
- The server validates the path, file size, and image header.
- The image is sent to the configured vision provider after approval.
- The response describes the visible content.

## Structured-output check

The two analysis tools accept `response_format: "json_object"`. When the provider follows the requested format:

- `data.analysis` contains the raw provider response;
- `data.parsed` contains `summary`, `observations`, `interpretations`, and `uncertainty`;
- `summary` is a string and the other fields are arrays of strings.

The MCP parser checks JSON syntax but does not yet enforce that schema. Valid JSON with the wrong shape does not trigger fallback. If a non-empty provider response is invalid JSON, the raw response is preserved in `data.parsed.summary` and the MCP reports:

```text
Vision response was not valid JSON; returned raw summary fallback.
```

An empty provider response returns `data.parsed: null` and the warning `Empty response`.

## Troubleshooting

### Cline does not show the tools

Check that:

- the MCP server entry is under `mcpServers`;
- `disabled` is not `true`;
- `args` and optional `cwd` values are absolute;
- `command` resolves to Node.js;
- the path to `src/server.js` exists;
- the JSON is valid and contains no comments;
- Cline has reloaded or restarted the server.

### Cline proposes an invalid prefixed tool name

Reload the MCP server and start a fresh conversation. Confirm the exact names Cline currently exposes and ask the model to use those names rather than constructing a prefix manually.

Do not rename the MCP server or add aliases on the basis of one intermittent failure. Record the Cline version, model, exposed name, attempted name, and whether the server was reached. Persistent failures may be a client/model tool-calling compatibility problem.

### The server starts but vision calls fail

Check that:

- `.env` exists in the repository root next to `package.json` and is not named `.env.txt`;
- the configured `args` path points to `src/server.js` in that same clone;
- `VISION_API_KEY` is present and valid;
- `VISION_BASE_URL` points to the correct OpenAI-style provider base URL;
- `VISION_MODEL` is a vision-capable model available to your account;
- the provider accepts mixed `text` and `image_url` message content;
- the provider returns text at `choices[0].message.content`.

If non-empty provider variables are also present in the Cline `env` block or inherited process environment, they override matching values in `.env`. Remove the duplicate source or update it deliberately, then restart the MCP server.

### Screenshot capture fails

Run:

```bash
npx playwright install --only-shell chromium
npm test
```

Also check whether the target page blocks automation, requires login, is behind a paywall, or renders an anti-bot page. The server does not bypass these controls.

### Localhost capture is blocked

This is the default safety behaviour. For local development only, set:

```env
ALLOW_LOCALHOST=true
```

### Local image paths are rejected

Check that the path is absolute, the file exists, it is inside an allowed directory, it is smaller than `MAX_IMAGE_BYTES`, and its header matches a supported image format. To allow additional folders, set `ALLOWED_IMAGE_DIRS` to a comma-separated list of absolute paths.

### The model seems confused by page content

Webpage and image content is untrusted data. Text inside screenshots must not be treated as instructions. Review tool calls before approval and avoid broad auto-approval for a new MCP server.

## Security notes

- Only install MCP servers you trust.
- Keep `autoApprove` empty until you understand the server behaviour.
- Review tool calls before approval.
- Prefer one credential source; the recommended local source is the ignored `.env` file.
- Use `.clineignore` to reduce automatic access to credential files, but do not treat it as a security boundary.
- Never ask Cline to inspect, search, copy, or print `.env` or credential values.
- Do not commit `.env`, API keys, private screenshots, or MCP client configurations containing secrets.
- `capture_page_screenshot` visits the requested URL from your local machine.
- `analyze_page_screenshot` and `analyze_image` send image content to the configured vision provider.
- Use `ALLOWED_DOMAINS`, `BLOCKED_DOMAINS`, and `ALLOW_LOCALHOST` deliberately.

## Related documentation

- [Model discovery release check](./model-discovery-check.md)
- [Cline MCP documentation](https://docs.cline.bot/mcp/mcp-overview)
- [Model Context Protocol local server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [Model Context Protocol debugging guide](https://modelcontextprotocol.io/docs/tools/debugging)
