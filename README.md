# web-perception MCP Server

[![Test](https://github.com/JaviGala/web-perception-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/JaviGala/web-perception-mcp/actions/workflows/test.yml)

A small local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that lets non-visual LLMs inspect images and webpage screenshots through a configurable vision-capable model.

```text
non-visual model → image or webpage screenshot → vision model → grounded text/JSON result
```

The project deliberately stays focused on three operations: load or capture images, send them to a vision provider, and return the result. It is an experimental AI-assisted project rather than production-audited infrastructure.

## Tools

| Tool | Purpose | Vision API call? |
| --- | --- | --- |
| `analyze_image` | Analyse one or more local image files. | Yes |
| `capture_page_screenshot` | Capture a rendered webpage to local screenshot files. | No |
| `analyze_page_screenshot` | Capture a webpage and analyse what is visible. | Yes |

Page tools can also return compact context such as the title, headings, visible-text excerpt, key interactive elements, final HTTP status, and capture-health warnings.

This is not a general browser-automation MCP. It does not click through flows, fill forms, expose the full DOM, or bypass Cloudflare, captchas, paywalls, login requirements, regional blocks, or other access controls.

## Requirements

- Node.js 18+
- An MCP client that can run local `stdio` servers
- An API key for an OpenAI-compatible vision endpoint
- Playwright Chromium

## Install

```bash
git clone https://github.com/JaviGala/web-perception-mcp.git
cd web-perception-mcp
npm install
npx playwright install chromium
cp .env.example .env
```

Set at least these values in `.env` or in the MCP client configuration:

```env
VISION_API_KEY=your_key_here
VISION_BASE_URL=https://your-provider.example/v1
VISION_MODEL=your-vision-model
```

The provider must accept an OpenAI-style `/chat/completions` request with mixed `text` and `image_url` content. Compatibility varies between providers and models.

## MCP client configuration

Generic local `stdio` configuration:

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

Use forward slashes or escaped backslashes in Windows JSON paths. For a tested Cline setup and troubleshooting, see [`docs/cline-setup.md`](./docs/cline-setup.md).

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

## Screenshots and diagnostics

Screenshots are stored by default in an app-owned folder inside the operating-system temporary directory. The tools return local paths and `file://` URLs but do not open or execute them.

Section capture uses several viewport-sized screenshots rather than one extremely tall image. `analyze_page_screenshot` sends at most eight sections to the vision model; capture-only requests can create up to twenty.

Page responses include an `http_status` and `page_health` summary to help distinguish a useful capture from HTTP errors, bot protection, login walls, paywalls, JavaScript failures, or unusually empty pages.

## Security

The server handles untrusted URLs, webpages, and local files. Its safeguards include:

- accepting only `http:` and `https:` page URLs;
- blocking localhost, raw IP addresses, private/reserved ranges, and cloud metadata endpoints by default;
- checking browser requests during navigation and capture;
- validating local image paths, sizes, counts, and file signatures;
- treating visible page and image text as untrusted content rather than tool instructions.

These are mitigations, not guarantees. Do not let downstream agents execute commands, reveal secrets, modify files, or call tools solely because a captured page or image tells them to do so.

Do not commit `.env` files, API keys, private screenshots, or MCP client configurations containing secrets. Maintainer and release checks are documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Development

```bash
npm test
```

Contribution scope, project structure, release versioning, secret scanning, and dependency-licence checks are covered in [`CONTRIBUTING.md`](./CONTRIBUTING.md). The broader scoping retrospective is in [`docs/scope-retrospective.md`](./docs/scope-retrospective.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
