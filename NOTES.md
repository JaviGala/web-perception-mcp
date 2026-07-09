# Implementation notes

## Current PR direction

This branch has been reset toward the original product idea: delegated vision for non-visual LLMs.

The MCP should help models such as DeepSeek or GLM analyze images and webpage screenshots by delegating the visual part to a vision-capable model. It should not try to become a full browser automation, page scraping, UX review, or accessibility audit framework.

## Public tool surface

The active public tools are:

- `analyze_image` — send one or more local images to the configured vision model.
- `capture_page_screenshot` — capture webpage screenshot files and optional compact page context without a vision call.
- `analyze_page_screenshot` — capture webpage screenshot(s), add compact page context when useful, and ask the vision model to analyze them.

Removed from the active public API after the scope reset:

- `inspect_page`
- `perceive_page`
- `review_page_ux`
- `analyze_page_visual`
- `extract_page_data`

## Webpage handling principle

Webpage structure is supporting context, not the product itself.

The compact page context is limited to:

- URL and title,
- meta description when available,
- visible headings,
- a short visible-text excerpt,
- key interactive elements with refs, names/selectors and approximate bounding boxes.

This helps the vision prompt interpret screenshots without producing a large DOM dump that agent clients may truncate.

## Implemented in this PR

- Local image validation before MiniMax/nanoGPT vision calls.
- Image validation by file header, not just extension.
- Maximum image count and image size checks.
- OS temp directory allowed by default for generated screenshots and tests.
- DNS-aware URL validation for browser entry/final URLs.
- Browser request routing that validates remote subresource requests before continuing them.
- Service workers blocked in browser contexts so requests remain visible to Playwright routing.
- Screenshot capture modes: `viewport`, `full_page`, `element` by CSS selector, and ordered `sections`.
- Compact rendered page-context extraction for vision prompts.
- Focused public MCP tools aligned with delegated vision.
- Scope retrospective in `docs/scope-retrospective.md`.
- CI and regression tests.

## Still recommended before merge

- Confirm CI/checks on the final head.
- Run locally: `npm run check` and `npm test`.
- Smoke-test `analyze_image` with a known local image.
- Smoke-test `capture_page_screenshot` on a simple localhost page with `ALLOW_LOCALHOST=true`.
- Smoke-test `analyze_page_screenshot` on one public page and one localhost page.
- Update the PR title/body to reflect the scope reset before merging.

## Deferred, not current scope

These may become a separate project or later major version, but should not block this focused MCP:

- full DOM inspection as a public tool;
- generic page scraping;
- schema-based extraction from webpages;
- UX/design review wrappers;
- accessibility-audit wrappers;
- MCP resources or paginated page snapshots for complete DOM dumps.

## Operational notes

The earlier broad web-perception approach caused practical tool-output truncation in Cline. The current design avoids relying on a large all-in-one JSON response.

Earlier accidental empty files (`DUMMY` and `x`) were created while selecting the correct GitHub write operation and were removed in the same branch. They are not present in the final tree.
