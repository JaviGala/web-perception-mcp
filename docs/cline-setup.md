# Cline setup guide

This guide shows one tested way to use `web-perception-mcp` from Cline as a local `stdio` MCP server.

The project is intentionally small: it gives a non-visual coding agent access to local image analysis and webpage screenshot analysis through a configurable vision-capable model.

## Requirements

- Node.js 18 or newer.
- Cline installed in VS Code or another supported IDE.
- An API key for a compatible vision provider.
- Playwright Chromium installed for webpage screenshots.
- A local clone of this repository.

## Install the server locally

```bash
git clone https://github.com/JaviGala/web-perception-mcp.git
cd web-perception-mcp
npm install
cp .env.example .env
npx playwright install chromium
npm test
```

Edit `.env` and set the provider values:

```env
VISION_API_KEY=your_key_here
VISION_BASE_URL=https://your-provider.example/v1
VISION_MODEL=your-vision-model
```

For a local setup, keeping credentials only in this ignored `.env` file is the recommended approach. Avoid duplicating provider values in both `.env` and the Cline MCP configuration. Environment variables supplied by the MCP client take precedence over values in `.env`, which can make troubleshooting stale configuration harder.

## Add the MCP server in Cline

In the Cline panel:

1. Open **MCP Servers**.
2. Open the **Configure** tab.
3. Click **Configure MCP Servers**.
4. Add or update an entry under `mcpServers`.
5. Save the JSON file.
6. Restart or reload the MCP server from Cline.

Use absolute paths. Do not use `~` or relative paths in the MCP config.

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

The `cwd` value matters because the server loads `.env` from the repository root. Replace `/absolute/path/to/web-perception-mcp` with the real path to your local clone.

On Windows, use forward slashes or escaped backslashes in JSON strings:

```json
{
  "command": "node",
  "args": ["C:/Users/you/projects/web-perception-mcp/src/server.js"],
  "cwd": "C:/Users/you/projects/web-perception-mcp"
}
```

## Example nanoGPT configuration

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

## Smoke test 1: capture a screenshot without vision cost

Ask Cline to use the MCP server with a prompt like:

```text
Use the web-perception MCP server to call capture_page_screenshot with:
- url: https://example.com
- screenshot_mode: viewport
- include_page_context: true
- include_open_command: true

Do not call analyze_page_screenshot for this test.
```

Expected result:

- The tool returns `ok: true`.
- The page URL is `https://example.com/`.
- A local screenshot path or `file://` URL is returned.
- `page_health.capture_status` is `ok`.
- No vision-model API call is needed.

This test still uses Playwright/Chromium locally, so it can use CPU, memory, network access and disk space. It should not consume vision-model credits.

## Smoke test 2: analyse a webpage screenshot

Ask Cline:

```text
Use the web-perception MCP server to call analyze_page_screenshot with:
- url: https://example.com
- screenshot_mode: viewport
- include_page_context: true
- prompt: Describe what is visible on the page in a few sentences.
```

Expected result:

- The tool captures the page with Playwright.
- The screenshot is sent to the configured vision model.
- The answer describes the simple Example Domain page: a heading, a short paragraph and a Learn more link.

This test uses the configured vision provider.

### Structured-output check

To verify JSON output, repeat the analysis with:

```text
- response_format: json_object
```

Expected result:

- `data.analysis` contains the raw provider response.
- `data.parsed` contains exactly `summary`, `observations`, `interpretations` and `uncertainty`.
- `summary` is a string and the other fields are arrays of strings.
- No invalid-JSON fallback warning appears when the provider follows the requested format.

If the provider returns invalid JSON, the MCP preserves the raw response in `data.parsed.summary` and reports:

```text
Vision response was not valid JSON; returned raw summary fallback.
```

## Smoke test 3: analyse a local image

Use a local image path that is inside an allowed directory. By default, the server accepts images from the project directory, the app temp directory, the screenshot output directory and the OS temp directory.

```text
Use the web-perception MCP server to call analyze_image with:
- image_path: /absolute/path/to/image.png
- prompt: Describe the visible UI and any obvious usability issues.
```

Expected result:

- The server validates the path, file size and image header.
- The image is sent to the configured vision model.
- The response describes the visible content of the image.

## Troubleshooting

### Cline does not show the web-perception tools

Check:

- The MCP server entry is under `mcpServers`.
- `disabled` is not set to `true`.
- `command`, `args` and `cwd` use absolute paths.
- The path to `src/server.js` exists.
- The JSON is valid. MCP JSON config files cannot contain comments.
- Cline has been restarted or the MCP server has been reloaded.

### The server starts but vision calls fail

Check:

- `.env` exists in the repository root and is not named `.env.txt` or similar.
- `cwd` points to that repository root.
- `VISION_API_KEY` is present and valid.
- `VISION_BASE_URL` points to the correct OpenAI-style `/chat/completions` provider base URL.
- `VISION_MODEL` is a vision-capable model available to your account.
- The provider accepts mixed `text` and `image_url` message content.
- The provider returns text at `choices[0].message.content`.

If provider variables are also present in the Cline `env` block or inherited process environment, they override values with the same names in `.env`. Remove the duplicate source or update it deliberately, then restart the MCP server.

### Screenshot capture fails

Check:

```bash
npx playwright install chromium
npm test
```

Also check whether the target page blocks automation, requires login, is behind a paywall, or renders an anti-bot page. The server does not bypass Cloudflare, captchas, login walls, paywalls, regional blocks or age gates.

### Localhost capture is blocked

This is the default safety behaviour. For local development only, set:

```env
ALLOW_LOCALHOST=true
```

Use this only when you intentionally want the MCP server to capture a local development page.

### Local image paths are rejected

Check:

- The path is absolute.
- The file exists.
- The file is inside an allowed directory.
- The file is smaller than `MAX_IMAGE_BYTES`.
- The file header matches a supported image format.

To allow additional local folders, set `ALLOWED_IMAGE_DIRS` to a comma-separated list of absolute paths.

### The model seems confused by page content

Remember that webpage and image content is untrusted data. Text inside screenshots should not be treated as instructions. Review tool calls before approval and avoid enabling broad auto-approval for new MCP servers.

## Security notes

- Only install MCP servers you trust.
- Keep `autoApprove` empty until you understand the server behaviour.
- Review tool calls before approval.
- Prefer one credential source; the recommended local source is the ignored `.env` file.
- Do not commit `.env`, API keys, screenshots with private data or MCP client configuration containing secrets.
- `capture_page_screenshot` visits the requested URL from your local machine.
- `analyze_page_screenshot` and `analyze_image` send image content to your configured vision provider.
- Use `ALLOWED_DOMAINS`, `BLOCKED_DOMAINS` and `ALLOW_LOCALHOST` deliberately.

## Related documentation

- Cline MCP documentation: https://docs.cline.bot/mcp/mcp-overview
- Model Context Protocol local server guide: https://modelcontextprotocol.io/docs/develop/connect-local-servers
- Model Context Protocol debugging guide: https://modelcontextprotocol.io/docs/tools/debugging
- Playwright MCP Cline example: https://github.com/microsoft/playwright-mcp
