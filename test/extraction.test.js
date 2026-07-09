import test from "node:test";
import assert from "node:assert/strict";

import { launchBrowser, closeBrowser } from "../src/browser.js";
import { extractBasic, extractPageContext } from "../src/extraction.js";

const html = `<!doctype html>
<html>
  <head>
    <title>Example product page</title>
    <meta name="description" content="A concise product page description">
    <link rel="canonical" href="/canonical-product">
    <meta property="og:title" content="OG product title">
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Widget Pro"}
    </script>
  </head>
  <body>
    <main>
      <h1>Widget Pro</h1>
      <h2>Pricing</h2>
      <p>The Widget Pro is built for teams.</p>
      <a href="/pricing">View pricing</a>
    </main>
  </body>
</html>`;

test("extractBasic extracts core page metadata and content", () => {
	const result = extractBasic(html, "https://example.com/product", {
		maxTextLength: 1000,
	});

	assert.equal(result.ok, true);
	assert.equal(result.data.title, "Example product page");
	assert.equal(
		result.data.meta_description,
		"A concise product page description",
	);
	assert.equal(result.data.canonical_url, "https://example.com/canonical-product");
	assert.deepEqual(result.data.headings, [
		{ level: 1, text: "Widget Pro" },
		{ level: 2, text: "Pricing" },
	]);
	assert.equal(result.data.links[0].href, "https://example.com/pricing");
	assert.equal(result.data.og_metadata.title, "OG product title");
	assert.equal(result.data.jsonld[0].name, "Widget Pro");
});

test("extractBasic truncates long main text", () => {
	const longHtml = `<!doctype html><html><body><main><h1>Long</h1><p>${"x".repeat(2000)}</p></main></body></html>`;
	const result = extractBasic(longHtml, "https://example.com/long", {
		maxTextLength: 100,
	});

	assert.equal(result.ok, true);
	assert.equal(result.metadata.text_truncated, true);
	assert.match(result.data.main_text, /TRUNCATED/);
});

test("extractPageContext returns compact rendered context", async () => {
	let context;
	try {
		const launched = await launchBrowser({ viewport: { width: 900, height: 700 } });
		context = launched.context;
		const page = launched.page;
		await page.setContent(`<!doctype html>
			<html>
				<head><title>Rendered app</title></head>
				<body>
					<main>
						<h1>Dashboard</h1>
						<p>Visible summary text for the page.</p>
						<button>Save changes</button>
						<a href="/settings">Settings</a>
						<input aria-label="Search" />
					</main>
				</body>
			</html>`);

		const result = await extractPageContext(page, {
			maxTextLength: 200,
			maxHeadings: 5,
			maxInteractiveElements: 10,
		});

		assert.equal(result.title, "Rendered app");
		assert.equal(result.headings[0].text, "Dashboard");
		assert.match(result.visible_text_excerpt, /Visible summary text/);
		assert.deepEqual(
			result.interactive_elements.map((el) => el.text || el.accessible_name),
			["Save changes", "Settings", "Search"],
		);
		assert.equal(result.interactive_elements[0].ref, "e1");
		assert.equal(result.interactive_elements[0].selector, "main > button");
	} finally {
		await context?.close().catch(() => {});
		await closeBrowser();
	}
});
