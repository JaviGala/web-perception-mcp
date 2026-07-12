import test from "node:test";
import assert from "node:assert/strict";

import { buildPageHealth } from "../src/page-health.js";

function health(pageContext, options = {}) {
	return buildPageHealth(pageContext, options).pageHealth;
}

test("buildPageHealth marks normal pages as ok", () => {
	const result = buildPageHealth({
		title: "Example Domain",
		visible_text_excerpt: "Example Domain This domain is for use in illustrative examples in documents. Learn more",
		headings: [{ level: 1, text: "Example Domain" }],
		interactive_elements: [{ role: "link", text: "Learn more" }],
	});

	assert.equal(result.pageHealth.capture_status, "ok");
	assert.equal(result.pageHealth.suspicious_blank_or_error_page, false);
	assert.deepEqual(result.pageHealth.problem_categories, []);
	assert.deepEqual(result.warnings, []);
});

test("buildPageHealth detects low-content Sorry pages", () => {
	const result = health({
		title: "",
		visible_text_excerpt: "Sorry.",
		headings: [],
		interactive_elements: [],
	});

	assert.equal(result.capture_status, "low_content");
	assert.equal(result.suspicious_blank_or_error_page, true);
	assert.equal(result.problem_categories.includes("low_content"), true);
	assert.match(result.reasons.join("\n"), /Sorry/);
});

test("buildPageHealth detects Cloudflare-style bot-protection interstitials", () => {
	const result = buildPageHealth({
		title: "Just a moment...",
		visible_text_excerpt: "stackoverflow.com Performing security verification Verifying... Performance and Security by Cloudflare Ray ID: abc123",
		headings: [
			{ level: 1, text: "stackoverflow.com" },
			{ level: 2, text: "Performing security verification" },
		],
		interactive_elements: [{ role: "checkbox", accessible_name: "Verify you are human" }],
	});

	assert.equal(result.pageHealth.capture_status, "likely_bot_protection");
	assert.equal(result.pageHealth.suspicious_blank_or_error_page, true);
	assert.equal(result.pageHealth.problem_categories.includes("bot_protection"), true);
	assert.equal(result.pageHealth.confidence, "high");
	assert.match(result.pageHealth.signals.join("\n"), /Cloudflare|bot-protection|verification/i);
	assert.match(result.warnings.join("\n"), /bot-protection|security-verification/i);
});

test("buildPageHealth detects HTTP error pages", () => {
	const result = health({
		title: "404 Not Found",
		visible_text_excerpt: "Page not found. The requested page could not be found.",
		headings: [{ level: 1, text: "404 Not Found" }],
		interactive_elements: [],
	});

	assert.equal(result.capture_status, "likely_http_error");
	assert.equal(result.problem_categories.includes("http_error"), true);
	assert.equal(result.suspicious_blank_or_error_page, true);
});

test("buildPageHealth uses HTTP status even when the rendered page looks normal", () => {
	const result = health(
		{
			title: "Friendly missing page",
			visible_text_excerpt: "We could not find that resource. Return to the home page to continue browsing.",
			headings: [{ level: 1, text: "Something went wrong" }],
			interactive_elements: [{ role: "link", text: "Home" }],
		},
		{ statusCode: 404 },
	);

	assert.equal(result.http_status, 404);
	assert.equal(result.capture_status, "likely_http_error");
	assert.equal(result.problem_categories.includes("http_error"), true);
	assert.match(result.signals.join("\n"), /HTTP status is 404/);
});

test("buildPageHealth reports HTTP errors without page context", () => {
	const result = buildPageHealth(null, { statusCode: 503 });

	assert.equal(result.pageHealth.collected, false);
	assert.equal(result.pageHealth.http_status, 503);
	assert.equal(result.pageHealth.capture_status, "likely_http_error");
	assert.equal(result.pageHealth.suspicious_blank_or_error_page, true);
	assert.match(result.warnings.join("\n"), /503/);
});

test("buildPageHealth detects JavaScript loading failures", () => {
	const result = health({
		title: "React App",
		visible_text_excerpt: "You need to enable JavaScript to run this app.",
		headings: [],
		interactive_elements: [],
	});

	assert.equal(result.capture_status, "likely_js_loading_failure");
	assert.equal(result.problem_categories.includes("js_loading_failure"), true);
});

test("buildPageHealth detects login or paywall content", () => {
	const result = health({
		title: "Article",
		visible_text_excerpt: "Sign in to continue reading this article. Subscribe to continue.",
		headings: [{ level: 1, text: "Article" }],
		interactive_elements: [{ role: "button", text: "Sign in" }],
	});

	assert.equal(result.capture_status, "likely_login_or_paywall");
	assert.equal(result.problem_categories.includes("login_or_paywall"), true);
});
