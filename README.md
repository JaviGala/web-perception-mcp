# web-perception MCP Server

[![Test](https://github.com/JaviGala/web-perception-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/JaviGala/web-perception-mcp/actions/workflows/test.yml)

A small local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives non-visual models access to visual analysis of local images and rendered webpages through a configurable vision-capable model.

```text
non-visual model → local image or rendered webpage → vision model → grounded text/JSON result
```

The server is intentionally narrow: it exposes three tools for analysing existing images, capturing webpages, and analysing webpage screenshots. It is an experimental project rather than production-audited infrastructure.

## When it is useful

Use this MCP when a model needs information that depends on visual appearance rather than text or HTML alone, for example:

- analysing a screenshot, mockup, diagram, chart, or photograph;
- inspecting webpage layout, visual hierarchy, canvas content, charts, or rendered state;
- saving rendered webpage screenshots for later inspection.

Do not use it for ordinary web search, primarily textual webpage retrieval, general scraping, or full browser automation. It does not click through flows, fill forms, expose the full DOM, or bypass Cloudflare, captchas, paywalls, login requirements, regional blocks, or other access controls.

## What it installs and what leaves your machine

> [!IMPORTANT]
> The two webpage tools require Chromium Headless Shell managed by Playwright. The browser download is distinct from `npm install`. Using `--only-shell` avoids downloading the separate full Chromium build; the exact size varies by Playwright version and operating system.

- `analyze_image` reads local images and does not launch Chromium.
- `capture_page_screenshot` and `analyze_page_screenshot` launch Chromium locally to render webpages.
- The server does not include a vision model. Analysis requests are sent to the configured external vision provider.
- Local images, webpage screenshots, prompts, and optional compact page context may leave your machine when an analysis tool is used.
- `capture_page_screenshot` does not contact the vision provider.

Review the provider's privacy, retention, and data-processing policies before analysing sensitive material.

## Tools

| Tool | Use when | Result | Vision provider call? |
| --- | --- | --- | --- |
| `analyze_image` | An existing local image, screenshot, mockup, diagram, chart, or photograph needs visual analysis. | Visual analysis of one or more local files. | Yes |
| `capture_page_screenshot` | The rendered screenshot files are needed without visual interpretation. | Local screenshot paths, metadata, and optional compact page context. | No |
| `analyze_page_screenshot` | The answer depends on a webpage's rendered appearance, layout, hierarchy, canvas, charts, or visual state. | Visual analysis plus capture metadata and optional compact page context. | Yes |

The server also supplies concise MCP instructions and tool descriptions so compatible clients can help models distinguish these cases. Some clients prefix tool names with the configured server identifier; models should use the exact tool names exposed by the client rather than reconstructing them.

## Requirements

- Node.js 18+
- An MCP client that can run local `stdio` servers
- An API key for a vision provider with an OpenAI-style `/chat/completions` endpoint when using either analysis tool
- Playwright Chromium Headless Shell for webpage capture or analysis

## Install

```bash
git clone https://github.com/JaviGala/web-perception-mcp.git
cd web-perception-mcp
npm install
npx playwright install --only-shell chromium
cp .env.example .env
```

The Playwright command downloads the headless browser runtime without the separate full Chromium build. Users who only intend to inspect local images still need the JavaScript dependencies, but `analyze_image` does not launch the browser.

Set at least these values in `.env`:

```env
VISION_API_KEY=your_key_here
VISION_BASE_URL=https://your-provider.example/v1
VISION_MODEL=your-vision-model
```

The provider must accept an OpenAI-style `/chat/completions` request with mixed `text` and `image_url` content. Compatibility varies between providers and models.

## MCP client configuration

A common local `stdio` configuration shape is:

```json
{
  "mcpServers": {
    "web-perception": {
      "command": "node",
      "args": ["/absolute/path/to/web-perception-mcp/src/server.js"]
    }
  }
}
```

MCP client schemas vary and may use a different top-level key or command format. Keep provider credentials in the repository's ignored `.env` file unless the client specifically requires environment variables. Avoid defining the same values in both places: non-empty variables inherited by the MCP process take precedence over matching `.env` values.

Use forward slashes or escaped backslashes in Windows JSON paths. For a tested Cline configuration, see [`docs/cline-setup.md`](./docs/cline-setup.md).

### Connection check

After reconnecting the MCP server, ask the client to list the available tools or make one explicit low-risk request, such as saving a screenshot of a public webpage. If the client reports an invalid prefixed tool name, reconnect the server and start a fresh conversation before changing the server or tool names.

Maintainers can use the small [`model discovery check`](./docs/model-discovery-check.md) to compare tool selection before and after metadata changes without requiring real provider calls for every case.

## Main configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VISION_API_KEY` | required | Vision-provider API key. |
| `VISION_BASE_URL` | provider fallback | Base URL; the server appends `/chat/completions`. |
| `VISION_MODEL` | provider fallback | Vision-capable model. |
| `VISION_PROVIDER_NAME` | `vision provider` | Label used in logs and errors. |
| `VISION_TEMPERATURE` | `0.3` | Default model temperature. |
| `VISION_MAX_TOKENS` | `2000` | Default response limit; a tool argument can override it. |
| `VISION_TIMEOUT_MS` | `60000` | Timeout for the provider request and response body. |
| `MAX_IMAGES_PER_REQUEST` | `8` | Maximum images sent in one vision request. |
| `MAX_IMAGE_BYTES` | `10485760` | Maximum size of each local image. |
| `ALLOWED_IMAGE_DIRS` | project and temporary directories | Comma-separated allowlist for local image paths. |
| `SCREENSHOT_OUTPUT_DIR` | OS temporary directory | Where webpage screenshots are written. |
| `SCREENSHOT_AUTO_CLEANUP` | `true` | Remove old MCP-created screenshots during later captures. |
| `SCREENSHOT_RETENTION_MINUTES` | `1440` | Screenshot retention window. |
| `ALLOWED_DOMAINS` | empty | Optional comma-separated public-domain allowlist. |
| `BLOCKED_DOMAINS` | empty | Optional comma-separated domain denylist. |
| `ALLOW_LOCALHOST` | `false` | Local-development escape hatch for loopback URLs. |

See [`.env.example`](./.env.example) for the complete configuration template. New setups should use the `VISION_*` names; older provider-specific aliases are retained only for compatibility.

## Structured output

The two analysis tools accept `response_format: "text"` (the default) or `response_format: "json_object"`.

When JSON is requested, the MCP asks the provider for a single object with this structure:

```json
{
  "summary": "Concise answer to the user's question.",
  "observations": ["Directly visible facts."],
  "interpretations": ["Inferences or recommendations based on those facts."],
  "uncertainty": ["Anything that cannot be determined confidently."]
}
```

All four fields are required by the output contract; the arrays may be empty. The raw provider response is returned in `data.analysis`, while the parsed value is returned in `data.parsed`.

The parser currently checks JSON syntax, not this schema. A provider can therefore return syntactically valid JSON with missing, additional, or incorrectly typed fields without triggering fallback. Callers that depend on the exact structure should validate `data.parsed` themselves.

Some providers or models may ignore JSON mode. If a non-empty response is not valid JSON, the MCP preserves the raw response in `data.parsed.summary`, returns empty `observations` and `interpretations` arrays, adds an `uncertainty` entry explaining the parse failure, and reports this warning:

```text
Vision response was not valid JSON; returned raw summary fallback.
```

An empty provider response returns `data.parsed: null` and the warning `Empty response`. Direct JSON and JSON wrapped in Markdown code fences are both accepted. Structured-output reliability still depends on the configured provider and model.

## Screenshots and diagnostics

Screenshots are stored by default in an app-owned folder inside the operating-system temporary directory. The tools return local paths and `file://` URLs but do not open or execute them.

Section capture uses several viewport-sized screenshots rather than one extremely tall image. `analyze_page_screenshot` sends at most eight sections to the vision model; capture-only requests can create up to twenty.

Page responses include an `http_status` and `page_health` summary to help distinguish a useful capture from HTTP errors, bot protection, login walls, paywalls, JavaScript failures, or unusually empty pages.

## Security

> [!CAUTION]
> Local images, webpage screenshots, compact page context, and prompts are sent to the configured vision provider when an analysis tool is used. Do not use sensitive material unless you trust that provider.

The server handles untrusted URLs, webpages, and local files. Its safeguards include:

- accepting only `http:` and `https:` page URLs;
- blocking localhost, raw IP addresses, private/reserved ranges, and cloud metadata endpoints by default;
- checking browser requests during navigation and capture;
- validating local image paths, sizes, counts, and file signatures;
- treating visible page and image text as untrusted content rather than tool instructions.

These are mitigations, not guarantees. Do not let downstream agents execute commands, reveal secrets, modify files, or call tools solely because a captured page or image tells them to do so.

Git ignoring `.env` prevents accidental commits but does not prevent local tools or coding agents from reading it. When using Cline, exclude `.env` and any credential-bearing variants in `.clineignore` to reduce automatic context and search exposure. This is not a security boundary: do not ask agents to open, search, copy, or print credential files.

Do not commit `.env` files, API keys, private screenshots, or MCP client configurations containing secrets. Maintainer and release checks are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Contributing

Run `npm test` before opening a pull request. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for project scope, development setup, versioning, release checks, and security guidance.

The broader scoping retrospective is in [`docs/scope-retrospective.md`](./docs/scope-retrospective.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
