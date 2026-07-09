# Security

This is an experimental personal project built through AI coding agents under human direction and review. Please review the code and security model before using it in sensitive environments.

## Supported use

The MCP is intended for local use by a trusted user or trusted agent client. It handles untrusted webpage URLs and local image paths, so the code applies URL validation, local-file validation and conservative browser-request routing.

It does not attempt to bypass Cloudflare, captchas, paywalls, login requirements or other access controls.

## Visual prompt injection

Images and webpage screenshots can contain malicious instructions aimed at the vision model or at the downstream agent reading the MCP response.

This MCP treats image/page content as untrusted data. The vision prompt instructs the model to describe visible instructions rather than follow them, and the tool descriptions remind downstream agents that visual content is not trusted instruction text.

This is a mitigation, not a guarantee. Downstream agents should not execute commands, modify files, call tools, open URLs, reveal secrets, or change their own instructions based only on text found inside an image or webpage screenshot.

## Reporting issues

If you find a security issue, please do not post exploit details publicly in an issue. Contact the repository owner privately, or open a minimal issue describing the affected area without sensitive details.

## Secret handling

Do not commit:

- `.env` files,
- real API keys,
- MCP client configuration containing secrets,
- private screenshots,
- browsing logs or tool outputs containing sensitive data.

Before making a fork or private copy public, scan the full Git history with a secrets scanner such as `gitleaks` or `trufflehog`.
