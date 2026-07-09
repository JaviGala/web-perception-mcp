# web-perception MCP Server

[![Test](https://github.com/JaviGala/web-perception-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/JaviGala/web-perception-mcp/actions/workflows/test.yml)

A small [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that lets non-visual LLMs understand local images and webpage screenshots by delegating visual analysis to a configurable vision-capable model.

```text
non-visual model → image or webpage screenshot → vision model → grounded text/JSON result
```

Use it when an MCP-capable assistant or coding agent occasionally needs to inspect screenshots, UI mockups, charts, diagrams, visual bugs, or rendered webpages, but does not have native vision. The project is intentionally simple: it focuses on capture/load image → send to vision model → return result. More ambitious ideas such as richer page extraction, browser automation, UX review workflows, or multi-step research agents are better handled in forks or separate projects built on top of this baseline.

## Requirements

- Node.js 18+
- An MCP client that can run local `stdio` servers
- An API key for a compatible vision provider
- Playwright Chromium, installed with `npx playwright install chromium`

## What it does

- Analyze one or more local image files.
- Capture webpage screenshots with Playwright.
- Optionally include compact page context: title, visible headings, visible-text excerpt, and key interactive elements.
- Send image(s) to a configurable vision model through an OpenAI-style `/chat/completions` request.
- Return concise text or JSON analysis to the calling model.

## What it is not

This is not a full browser automation MCP. Use a browser MCP when the model needs to explore a page, inspect the full DOM, click through flows, fill forms, or retrieve arbitrary page data.

It also does not bypass Cloudflare, captchas, paywalls, login requirements, regional blocks, age gates, or other access controls. It only analyzes what Playwright can actually render.

## Development approach

This repository is transparent about how it was built: the codebase was generated and iterated with AI coding agents under human product direction, review, and testing. Treat it as an experimental AI-assisted software project, not as production-audited infrastructure.

The human contribution is primarily product framing, scope control, prompt specification, testing strategy, review of tool behaviour, and decisions about what to simplify or remove. See [`docs/scope-retrospective.md`](./docs/scope-retrospective.md) for the main scoping lessons from the broader web-perception experiment.

## Tools

| Tool | Use it when you need to… | What it does | Calls the vision API? |
| ---- | ------------------------ | ------------ | --------------------- |
| `analyze_image` | Understand one or more local image files. | Reads local image file(s), validates them, and sends them to the configured vision model. | Yes |
| `capture_page_screenshot` | Capture what a webpage looks like without asking a model to analyze it. | Opens the page with Playwright/Chromium and saves screenshot file(s) locally. | No |
| `analyze_page_screenshot` | Understand what is visible on a webpage. | Opens the page with Playwright/Chromium, saves screenshot file(s), and sends them to the configured vision model. | Yes |

`capture_page_screenshot` does not call the vision provider. It still uses local browser automation through Playwright/Chromium, so it may use local CPU, memory, network access, and disk space, but it does not consume vision-model API credits.

`capture_page_screenshot` defaults to `viewport` because it is primarily a capture/debugging tool. `analyze_page_screenshot` defaults to `sections` because several viewport-sized screenshots are usually easier for vision models to inspect than one very tall full-page image.

## Quick start

```bash
git clone https://github.com/JaviGala/web-perception-mcp.git
cd web-perception-mcp
npm install
cp .env.example .env
npx playwright install chromium
```

Then edit `.env` and set at least:

```env
VISION_API_KEY=your_key_here
VISION_BASE_URL=https://your-provider.example/v1
VISION_MODEL=your-vision-model
```

`.env.example` uses provider-agnostic placeholders by default. It also includes a commented nanoGPT + Minimax example from the original setup, but new users should set the provider and model explicitly for their own account.

## Vision provider compatibility

The client expects an OpenAI-style `/chat/completions` endpoint that accepts:

- `Authorization: Bearer <api key>` authentication
- `messages` with mixed `text` and `image_url` content entries
- data-URI image payloads such as `data:image/png;base64,...`
- a response at `choices[0].message.content`

Provider compatibility is not guaranteed. Providers may differ in endpoint paths, model names, image payload support, JSON response formatting, rate limits, authentication, or billing behaviour.

## MCP client configuration

This is a local `stdio` MCP server. The exact configuration format varies by client, but the generic shape is:

```json
{
  "mcpServers": {
    "web-perception": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/web-perception-mcp/src/server.js"],
      "env": {
        "VISION_API_KEY": "your-key-here",
        "VISION_BASE_URL": "https://your-provider.example/v1",
        "VISION_MODEL": "your-vision-model"
      }
    }
  }
}
```

If your client launches the server from the project directory, you can also keep provider values in `.env`. Some MCP clients do not inherit your shell environment, so explicit `env` entries can be more reliable.

### Windows path example

Use either escaped backslashes or forward slashes in JSON strings:

```json
{
  "command": "node",
  "args": ["C:/Users/you/projects/web-perception-mcp/src/server.js"]
}
```

For `npx`-based MCP servers on Windows, some clients require wrapping the command with `cmd /c`. This server normally uses `node` directly, so the wrapper is usually not needed.

## Configuration reference

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `VISION_API_KEY` | required | API key for the configured vision provider. |
| `VISION_BASE_URL` | fallback if unset | Base API URL. The client posts to `${VISION_BASE_URL}/chat/completions`. Set this explicitly for new configurations. |
| `VISION_MODEL` | fallback if unset | Vision-capable model to use. Set this explicitly for new configurations. |
| `VISION_PROVIDER_NAME` | `vision provider` | Optional label used in logs and error messages. |
| `VISION_TEMPERATURE` | `0.3` | Default temperature. |
| `VISION_MAX_TOKENS` | `2000` | Default max tokens. |
| `ALLOWED_IMAGE_DIRS` | project dir, app temp dir, screenshot output dir, OS temp dir | Comma-separated allowlist for local images. |
| `MAX_IMAGES_PER_REQUEST` | `8` | Maximum images sent in one vision request. |
| `MAX_IMAGE_BYTES` | `10485760` | Maximum size per image file. |
| `SCREENSHOT_OUTPUT_DIR` | `<OS temp dir>/web-perception-mcp` | Directory where webpage screenshots are saved. |
| `SCREENSHOT_AUTO_CLEANUP` | `true` | Delete old screenshots created by this MCP on later captures. |
| `SCREENSHOT_RETENTION_MINUTES` | `1440` | Retention window for screenshot cleanup, in minutes. Default is 24 hours. |
| `ALLOWED_DOMAINS` | empty | Optional comma-separated URL allowlist. Empty allows arbitrary public web domains. |
| `BLOCKED_DOMAINS` | empty | Optional comma-separated URL denylist. |
| `ALLOW_LOCALHOST` | `false` | Local-development escape hatch for localhost/loopback URLs. |

New configurations should use `VISION_*`. Older provider-specific aliases may still be accepted for backwards compatibility, but they are not recommended for new setups.

## Screenshot storage and cleanup

By default, screenshots are written to an app-owned folder inside the operating system temp directory:

```text
<OS temp dir>/web-perception-mcp/
```

Examples:

```text
macOS/Linux: /tmp/web-perception-mcp/
Windows: C:\Users\<you>\AppData\Local\Temp\web-perception-mcp\
```

The tool returns local paths and `file://` URLs so the calling MCP client or user can inspect the exact captured image. It does not open screenshots automatically.

Old screenshots created by this MCP are cleaned up opportunistically on later captures. The default retention window is 24 hours. Cleanup only targets regular files in the configured screenshot directory whose names match this MCP's screenshot filename prefix.

To keep screenshots longer or put them somewhere else:

```env
SCREENSHOT_OUTPUT_DIR=/path/to/debug/screenshots
SCREENSHOT_RETENTION_MINUTES=2880
```

To disable cleanup:

```env
SCREENSHOT_AUTO_CLEANUP=false
```

## Example prompts

Capture a webpage screenshot without vision cost:

```text
Use capture_page_screenshot with:
- url: https://example.com
- screenshot_mode: viewport
- include_page_context: true
```

Analyze a webpage screenshot directly:

```text
Use analyze_page_screenshot with:
- url: https://example.com
- prompt: What is visible and is the primary call to action clear?
- include_page_context: true
```

Analyze a local screenshot or mockup:

```text
Use analyze_image with:
- image_path: /path/to/screenshot.png
- prompt: Describe the visible UI and identify any obvious usability issues.
```

On Windows, image paths can use normal Windows syntax if your MCP client passes them unchanged:

```text
C:\Users\you\Pictures\screenshot.png
```

## Capture diagnostics

`capture_page_screenshot` and `analyze_page_screenshot` return page-health diagnostics so the caller can distinguish a successful capture from a rendered error page, bot-protection page, login wall, paywall, or low-content page.

The response includes fields such as:

```json
{
  "screenshot_path": "/tmp/web-perception-mcp/web-perception-screenshot-123.png",
  "screenshot_file_url": "file:///tmp/web-perception-mcp/web-perception-screenshot-123.png",
  "page_health": {
    "capture_status": "ok",
    "problem_categories": [],
    "suspicious_blank_or_error_page": false,
    "reasons": []
  }
}
```

The MCP does not return an open command by default. To request a best-effort manual open command for your current OS, pass:

```text
include_open_command: true
```

The returned command is only a convenience string. The MCP does not execute it.

## Security notes

The server handles untrusted URLs and local image paths, so it applies conservative defaults:

- Only `http:` and `https:` URLs are accepted for webpage screenshots.
- Raw IP addresses, localhost, loopback, private/reserved ranges, and cloud metadata endpoints are blocked by default.
- Browser requests are checked during navigation and screenshot capture.
- Service workers are blocked in browser contexts so requests remain visible to the routing layer.
- Local image files are validated by path, size, count, and file header before being sent to the vision API.
- Image and webpage content is treated as untrusted data, not as instructions to follow.

This is a mitigation, not a guarantee. Downstream agents should not execute commands, modify files, call tools, open URLs, reveal secrets, or change their own instructions based only on text found inside an image or webpage screenshot.

Do not commit `.env` files, real API keys, MCP client config containing secrets, screenshots with private data, or logs from private browsing sessions.

## Project structure

```text
src/
  server.js             — MCP server and focused public tools
  vision.js             — configurable vision model client, image validation, visual prompt helpers
  browser.js            — Playwright browser launch, URL request safety, screenshot capture
  extraction.js         — compact page-context extraction for vision prompts
  page-health.js        — capture-quality diagnostics for rendered page context
  paths.js              — cross-platform temp paths, screenshot output and cleanup helpers
  screenshot-result.js  — screenshot result normalisation helpers
  security.js           — URL validation, SSRF protection, env loading, safe logging
```

## Development

```bash
npm test
```

Before making a private fork public, scan the full Git history with a secrets scanner such as `gitleaks` or `trufflehog`; checking only the current files is not enough.

For third-party dependency licenses, this project keeps the process lightweight: dependencies are installed through npm and are not vendored into the repository. Before public release, and after dependency changes, run a production dependency license check:

```bash
npx --yes license-checker-rseidelsohn --production --excludePrivatePackages --summary
npx --yes license-checker-rseidelsohn --production --excludePrivatePackages --onlyAllow 'MIT;MIT-0;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC'
```

If this project later distributes bundled dependencies, generated browser binaries, Docker images, or packaged apps, review the distribution-specific notice requirements separately. In particular, Playwright may download browser binaries that are not committed to this source repository.

See `docs/scope-retrospective.md` for the lessons learned from the broader web-perception experiment.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
