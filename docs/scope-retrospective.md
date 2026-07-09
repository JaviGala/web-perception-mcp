# Scope retrospective: delegated vision vs. full web perception

This project started with a narrow goal: let non-visual LLMs use a vision-capable model through an MCP server.

The intended workflow was:

```text
non-visual model → image file → MCP → vision model → textual/JSON analysis → non-visual model
```

That remains the clearest product boundary.

## What we tried

We explored expanding the MCP from image analysis into broader webpage perception:

- browser-rendered DOM extraction,
- headings, links, forms, landmarks and regions,
- element refs, selectors, bounding boxes and accessibility names,
- screenshot sections,
- perception packages,
- UX review tools,
- structured page-data extraction.

The reasoning was sound: webpage screenshots are easier to interpret when the vision model receives some page structure alongside the pixels.

## What went wrong

The expansion changed the product from a vision adapter into a partial browser/UX framework.

The most visible failure was long MCP tool output. `inspect_page full` returned a large JSON response containing page metadata, visible text, regions, forms and many elements. In Cline, the middle of that output could be truncated before the model read it. In one smoke test, the actual MCP result contained the correct buttons, but the model view hid the middle section where those buttons lived.

Different models reacted differently:

- one model appeared to infer or hallucinate missing values;
- another model correctly reported that the tool output was middle-truncated and refused to infer.

This showed that the issue was not only extraction correctness. The issue was product fit: a large all-in-one page dump is not a reliable interface for agent clients.

## What we learned

### 1. Complete data and usable model context are different things

A server can technically produce complete page data, but if the host truncates or compresses the result before the model reads it, the model cannot reliably use it.

For large data, a robust MCP should use paging, resources, or narrower tools. That is a larger architecture than the original project needs.

### 2. A browser MCP already covers much of the full-page exploration problem

If a non-visual model needs to inspect a page, click through flows, execute JavaScript, retrieve arbitrary DOM data, or paginate through content, a browser automation MCP is the right tool.

This project does not need to duplicate that surface area.

### 3. Webpage structure is still useful, but only as compact support for vision

For webpage screenshots, the useful context is small:

- URL and title,
- visible headings,
- a short visible-text excerpt,
- key buttons, links and inputs,
- approximate positions.

That context helps the vision model interpret the screenshot without turning the tool response into a large DOM dump.

### 4. The public API should match the core product

The earlier API exposed tools such as `inspect_page`, `perceive_page`, `review_page_ux`, `analyze_page_visual` and `extract_page_data`. Those names encouraged broad webpage analysis and UX-review workflows.

The reset API is smaller:

- `analyze_image`
- `capture_page_screenshot`
- `analyze_page_screenshot`

This better matches the original purpose: delegated vision.

## Current direction

The MCP should answer this question:

> How can a non-visual model understand an image or webpage screenshot?

It should not try to answer this broader question:

> How can a non-visual model fully inspect, scrape, reason about and review a webpage?

That broader question may justify a future project, but it should not complicate the MVP.

## Future expansion rules

Before adding a new tool, check whether it supports delegated vision directly.

Good candidates:

- compare two images;
- compare two webpage screenshots;
- analyze a specific screenshot region;
- OCR-focused image analysis;
- chart/diagram interpretation;
- visual regression summary.

Risky candidates:

- full DOM inspection;
- page scraping;
- UX review as a separate high-level product;
- accessibility auditing;
- arbitrary structured data extraction from webpages.

Those may be useful, but they belong to a fuller browser/perception framework, not this focused vision adapter.
