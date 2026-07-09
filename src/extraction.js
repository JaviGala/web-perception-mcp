// extraction.js — compact page context helpers for vision prompts

import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { enforceLimits } from "./security.js";

export function extractBasic(html, finalUrl, options = {}) {
	const { maxTextLength = 10000 } = options;
	const warnings = [];

	let dom;
	try {
		dom = new JSDOM(html, { url: finalUrl });
	} catch (err) {
		return {
			ok: false,
			error: {
				code: "HTML_PARSE_FAILED",
				message: `Failed to parse HTML: ${err.message}`,
			},
			warnings,
			partial: null,
		};
	}

	const doc = dom.window.document;
	const title = extractTitle(doc);
	const metaDescription = extractMetaDescription(doc);
	const canonicalUrl = extractCanonical(doc, finalUrl);
	const headings = extractHeadings(doc);

	let mainText = "";
	try {
		const reader = new Readability(doc.cloneNode(true));
		const article = reader.parse();
		if (article?.textContent) {
			mainText = article.textContent.trim();
		}
	} catch (err) {
		warnings.push(`Readability extraction failed: ${err.message}`);
	}

	if (!mainText) {
		const body = doc.querySelector("body");
		if (body) {
			mainText = body.textContent.replace(/\s+/g, " ").trim();
			warnings.push("Readability returned no main text; used body text fallback");
		}
	}

	const truncatedText = enforceLimits(mainText, maxTextLength);
	if (truncatedText.truncated) {
		warnings.push(`Main text truncated to ${maxTextLength} characters`);
	}

	return {
		ok: true,
		data: {
			url: finalUrl,
			title,
			meta_description: metaDescription,
			canonical_url: canonicalUrl,
			headings,
			main_text: truncatedText.text,
			links: extractLinks(doc, finalUrl),
			og_metadata: extractOpenGraph(doc),
			jsonld: extractJsonLd(doc),
		},
		warnings,
		metadata: {
			tool: "extractBasic",
			extraction_method: "static",
			text_truncated: truncatedText.truncated,
		},
	};
}

/**
 * Extract a deliberately compact browser-rendered page context for vision prompts.
 * This is not intended to be a full DOM dump. Browser/Playwright MCPs are better for that.
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {number} [options.maxTextLength=1800]
 * @param {number} [options.maxHeadings=20]
 * @param {number} [options.maxInteractiveElements=30]
 */
export async function extractPageContext(page, options = {}) {
	const {
		maxTextLength = 1800,
		maxHeadings = 20,
		maxInteractiveElements = 30,
	} = options;

	return page.evaluate(
		(args) => {
			const { maxTextLength, maxHeadings, maxInteractiveElements } = args;
			const doc = document;

			function normalizeText(text, maxLen = 200) {
				const normalized = (text || "").replace(/\s+/g, " ").trim();
				return normalized ? normalized.slice(0, maxLen) : null;
			}

			function cssIdentEscape(value) {
				if (window.CSS?.escape) return CSS.escape(value);
				return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
			}

			function cssStringEscape(value) {
				return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			}

			function isVisible(el) {
				const rect = el.getBoundingClientRect();
				const style = window.getComputedStyle(el);
				if (rect.width <= 0 || rect.height <= 0) return false;
				if (style.display === "none" || style.visibility === "hidden") return false;
				if (Number(style.opacity) === 0) return false;
				return true;
			}

			function bbox(el) {
				const rect = el.getBoundingClientRect();
				return {
					x: Math.round(rect.x),
					y: Math.round(rect.y),
					w: Math.round(rect.width),
					h: Math.round(rect.height),
				};
			}

			function getStableSelector(el) {
				const testAttrs = ["data-testid", "data-test", "data-qa", "data-cy"];
				for (const attr of testAttrs) {
					const value = el.getAttribute(attr);
					if (value) return `[${attr}="${cssStringEscape(value)}"]`;
				}
				if (el.id) return `#${cssIdentEscape(el.id)}`;

				const parts = [];
				let current = el;
				while (current && current.nodeType === Node.ELEMENT_NODE && current !== doc.body) {
					let part = current.tagName.toLowerCase();
					part += Array.from(current.classList || [])
						.filter((name) => !/[0-9]{3,}/.test(name))
						.slice(0, 2)
						.map((name) => `.${cssIdentEscape(name)}`)
						.join("");
					const parent = current.parentElement;
					if (parent) {
						const siblings = Array.from(parent.children).filter(
							(node) => node.tagName === current.tagName,
						);
						if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
					}
					parts.unshift(part);
					if (parts.length >= 4) break;
					current = parent;
				}
				return parts.join(" > ");
			}

			function labelForId(id) {
				if (!id) return null;
				try {
					return normalizeText(doc.querySelector(`label[for="${cssStringEscape(id)}"]`)?.textContent);
				} catch {
					return null;
				}
			}

			function accessibleName(el) {
				const labelledBy = el.getAttribute("aria-labelledby");
				if (labelledBy) {
					const text = labelledBy
						.split(/\s+/)
						.map((id) => doc.getElementById(id)?.textContent || "")
						.join(" ");
					const normalized = normalizeText(text);
					if (normalized) return normalized;
				}
				return (
					normalizeText(el.getAttribute("aria-label")) ||
					labelForId(el.id) ||
					normalizeText(el.closest("label")?.textContent) ||
					normalizeText(el.getAttribute("alt")) ||
					normalizeText(el.getAttribute("title")) ||
					normalizeText(el.textContent)
				);
			}

			function visibleTextExcerpt() {
				let text = "";
				const root = doc.body || doc.documentElement;
				const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
					acceptNode(node) {
						if (!node.parentElement || !isVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
						return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
					},
				});
				let textNode;
				while ((textNode = walker.nextNode())) {
					const value = textNode.textContent.replace(/\s+/g, " ").trim();
					if (!value) continue;
					text += (text ? " " : "") + value;
					if (text.length >= maxTextLength) break;
				}
				return text.slice(0, maxTextLength);
			}

			const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))
				.filter(isVisible)
				.slice(0, maxHeadings)
				.map((el) => ({
					level: Number(el.tagName.charAt(1)),
					text: normalizeText(el.textContent, 180),
					selector: getStableSelector(el),
					bbox: bbox(el),
				}))
				.filter((heading) => heading.text);

			const interactiveSelector = [
				"button",
				"a[href]",
				"input",
				"select",
				"textarea",
				"[role='button']",
				"[role='link']",
				"[role='textbox']",
				"[role='checkbox']",
				"[role='radio']",
				"[role='combobox']",
			].join(", ");

			const seen = new Set();
			let refCounter = 0;
			const interactive = [];
			for (const el of Array.from(doc.querySelectorAll(interactiveSelector))) {
				if (interactive.length >= maxInteractiveElements) break;
				if (seen.has(el) || !isVisible(el)) continue;
				seen.add(el);
				const tag = el.tagName.toLowerCase();
				const role = el.getAttribute("role") || tag;
				const ref = `e${++refCounter}`;
				el.setAttribute("data-wm-ref", ref);
				interactive.push({
					ref,
					tag,
					role,
					text: normalizeText(el.textContent, 120),
					accessible_name: accessibleName(el),
					selector: getStableSelector(el),
					href: tag === "a" ? el.href : null,
					type: el.getAttribute("type") || null,
					bbox: bbox(el),
					disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true" || false,
				});
			}

			return {
				url: window.location.href,
				title: doc.title || null,
				meta_description: doc.querySelector('meta[name="description"]')?.content || null,
				viewport: { width: window.innerWidth, height: window.innerHeight },
				headings,
				interactive_elements: interactive,
				visible_text_excerpt: visibleTextExcerpt(),
				counts: {
					headings: headings.length,
					interactive_elements: interactive.length,
				},
			};
		},
		{ maxTextLength, maxHeadings, maxInteractiveElements },
	);
}

function extractTitle(doc) {
	return doc.querySelector("title")?.textContent?.trim() || "";
}

function extractMetaDescription(doc) {
	return doc.querySelector('meta[name="description"]')?.getAttribute("content") || null;
}

function extractCanonical(doc, fallbackUrl) {
	const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
	if (!href) return null;
	try { return new URL(href, fallbackUrl).href; } catch { return href; }
}

function extractHeadings(doc) {
	const headings = [];
	doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((el) => {
		const level = parseInt(el.tagName.charAt(1), 10);
		const text = el.textContent?.trim();
		if (text) headings.push({ level, text });
	});
	return headings;
}

function extractLinks(doc, baseUrl) {
	const links = [];
	const seen = new Set();
	doc.querySelectorAll("a[href]").forEach((el) => {
		const href = el.getAttribute("href");
		const text = el.textContent?.trim();
		if (!href || !text) return;
		try {
			const abs = new URL(href, baseUrl).href;
			if (!seen.has(abs)) {
				seen.add(abs);
				links.push({ text: text.slice(0, 200), href: abs });
			}
		} catch {}
	});
	return links.slice(0, 200);
}

function extractOpenGraph(doc) {
	const og = {};
	doc.querySelectorAll('meta[property^="og:"]').forEach((el) => {
		const key = el.getAttribute("property")?.replace("og:", "");
		const val = el.getAttribute("content");
		if (key && val) og[key] = val;
	});
	return og;
}

function extractJsonLd(doc) {
	const jsonLd = [];
	doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
		try { jsonLd.push(JSON.parse(el.textContent)); } catch {}
	});
	return jsonLd;
}
