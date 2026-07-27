# Model discovery check

Use this check before a release that changes MCP instructions, tool names, descriptions, or input schemas. It evaluates whether a model that has not read the repository can choose the correct tool and understand important tool limits from the metadata exposed by the MCP client.

This is a small manual evaluation, not a benchmark. Do not provide the README or explain the tool catalogue before running it.

## Preparation

1. Start the candidate server through the MCP client.
2. Reconnect it and start a fresh conversation.
3. Confirm that the client exposes exactly these tools:
   - `analyze_image`
   - `capture_page_screenshot`
   - `analyze_page_screenshot`
4. Keep tool approval enabled so calls can be inspected before execution.
5. Stop each test after the proposed tool call when a real webpage or vision-provider request is unnecessary.

Some clients prefix tool names with the configured server identifier. Record the exact name shown by the client; the model should reproduce that exposed name rather than construct one itself.

## Test cases

Run each case in a fresh conversation. Replace placeholder paths or URLs only when needed.

| Case | Prompt | Expected decision |
| --- | --- | --- |
| Local screenshot | `Analyse the visible layout and controls in /absolute/path/to/screenshot.png.` | Use `analyze_image` with the local path and a relevant prompt. |
| Local chart | `Explain the main visual pattern in /absolute/path/to/chart.png.` | Use `analyze_image`. |
| Short visual webpage | `Inspect https://example.com as rendered and describe its visual hierarchy.` | Use `analyze_page_screenshot` with `screenshot_mode: "viewport"`. |
| Long visual webpage | `Inspect the MDN JavaScript Guide as rendered and describe its overall layout and structure across the page.` | Use `analyze_page_screenshot` with `screenshot_mode: "sections"` to cover multiple scroll positions. |
| Truncated sections continuation | `The previous sections capture stopped before the end of the page. Continue from where it stopped and analyse the remaining lower portion.` | Do not repeat the same `sections` call as though it resumes. Explain that each current `sections` call starts at the page top and the API has no continuation offset/token; limit the analysis or choose another supported workflow. |
| Structured analysis | `Analyse the rendered layout of https://example.com and return the MCP's structured JSON findings.` | Use `analyze_page_screenshot` with `response_format: "json_object"`; understand that parsed findings use `summary`, `observations`, `interpretations`, and `uncertainty`, and that callers must check `data.parsed` and warnings rather than assuming parsing succeeded. |
| Canvas or rendered state | `Look at https://example.com/app and explain what is visible in the rendered canvas.` | Use `analyze_page_screenshot`; use `viewport` unless the task explicitly requires content beyond the initial visible state. |
| Screenshot file only | `Save a viewport screenshot of https://example.com. Do not analyse it.` | Use `capture_page_screenshot`. |
| Textual negative control | `Fetch and summarise the main text from https://example.com.` | Do not use a web-perception visual tool when an ordinary fetch tool is available. |

## Record

For each case, record:

- client and version;
- model and version;
- exact tool name exposed by the client;
- first tool selected, or no tool;
- proposed arguments;
- whether the name was valid;
- whether the selection matched the expected decision;
- any extra instruction needed from the user.

For tool-using cases, also record whether the model distinguishes mutation risk from operational effects. Webpage analysis should not be described as having “no risk”: it makes a network request, launches a local browser, creates screenshot files, sends content to the configured provider, and may consume quota. A satisfactory assessment can still describe the task as low risk to the repository and target page.

For the continuation case, specifically record whether the model invents unsupported arguments such as `start_y`, `start_section`, or a continuation token, or simply repeats the same truncated call while claiming it will resume.

For the structured-output case, record whether the model understands that `json_object` requests a provider format rather than guaranteeing successful parsing, and whether it distinguishes the MCP response envelope from the parsed findings in `data.parsed`.

A result is satisfactory when the model selects the expected tool on the first attempt, supplies only supported arguments, avoids the visual tools for the textual negative control, does not invent continuation behaviour, understands the structured-output contract, and does not erase relevant operational effects behind an absolute `Risks: None` statement.

A single intermittent failure should be repeated once in a fresh conversation. Persistent invalid prefixed names should be investigated as a client/model compatibility issue before changing the server's public name or adding aliases.
