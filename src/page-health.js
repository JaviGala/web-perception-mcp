const BOT_PROTECTION_TITLE_PATTERNS = [
	/^just a moment\.?$/i,
	/^attention required!?/i,
	/^access denied$/i,
	/^are you human\??$/i,
	/^security check$/i,
];

const HTTP_ERROR_TITLE_PATTERNS = [
	/\b(403|404|429|500|502|503)\b/i,
	/\bnot found\b/i,
	/\bforbidden\b/i,
	/\btoo many requests\b/i,
	/\bserver error\b/i,
	/\bservice unavailable\b/i,
];

const JS_LOADING_PATTERNS = [
	/you need to enable javascript/i,
	/please enable javascript/i,
	/this site requires javascript/i,
	/enable cookies/i,
	/unsupported browser/i,
];

const LOGIN_OR_PAYWALL_PATTERNS = [
	/sign in to continue/i,
	/log in to continue/i,
	/subscribe to continue/i,
	/create an account to read/i,
	/content is only available to subscribers/i,
];

const GEO_OR_POLICY_BLOCK_PATTERNS = [
	/not available in your region/i,
	/unavailable in your country/i,
	/confirm your age/i,
	/age verification/i,
	/restricted access/i,
];

function pushUnique(array, value) {
	if (!array.includes(value)) array.push(value);
}

function textIncludesAll(text, terms) {
	const lower = text.toLowerCase();
	return terms.every((term) => lower.includes(term.toLowerCase()));
}

function matchesAny(value, patterns) {
	return patterns.some((pattern) => pattern.test(value));
}

function addSignal(signals, signal) {
	pushUnique(signals, signal);
}

function addProblem(problemCategories, reasons, warnings, signals, category, reason, signal = null) {
	pushUnique(problemCategories, category);
	pushUnique(reasons, reason);
	pushUnique(warnings, reason);
	if (signal) addSignal(signals, signal);
}

function detectBotProtection({ title, visibleText, combinedText, problemCategories, reasons, warnings, signals }) {
	let matched = false;

	if (matchesAny(title, BOT_PROTECTION_TITLE_PATTERNS)) {
		matched = true;
		addSignal(signals, `title matched bot-protection pattern: ${title}`);
	}

	const cloudflareSignals = [
		textIncludesAll(combinedText, ["cloudflare", "security verification"]),
		textIncludesAll(combinedText, ["cloudflare", "ray id"]),
		textIncludesAll(combinedText, ["cloudflare", "verifying"]),
		textIncludesAll(combinedText, ["cloudflare", "challenge"]),
		textIncludesAll(combinedText, ["performance and security", "cloudflare"]),
	];

	if (cloudflareSignals.some(Boolean)) {
		matched = true;
		addSignal(signals, "visible text contains Cloudflare security/challenge signals");
	}

	const botProtectionPatterns = [
		/performing security verification/i,
		/verify you are human/i,
		/checking your browser/i,
		/turnstile/i,
		/hcaptcha/i,
		/recaptcha/i,
		/datadome/i,
		/akamai/i,
		/perimeterx/i,
		/human security/i,
		/imperva/i,
		/distil networks/i,
		/bot protection/i,
	];

	if (matchesAny(visibleText, botProtectionPatterns)) {
		matched = true;
		addSignal(signals, "visible text contains bot-protection or verification terms");
	}

	if (matched) {
		addProblem(
			problemCategories,
			reasons,
			warnings,
			signals,
			"bot_protection",
			"Captured page appears to be a bot-protection or security-verification interstitial rather than the requested content.",
		);
	}
}

function detectHttpError({ title, visibleText, problemCategories, reasons, warnings, signals }) {
	const matchedTitle = matchesAny(title, HTTP_ERROR_TITLE_PATTERNS);
	const matchedText = /\b(403 forbidden|404 not found|429 too many requests|500 internal server error|502 bad gateway|503 service unavailable|page not found)\b/i.test(visibleText);
	if (!matchedTitle && !matchedText) return;

	addProblem(
		problemCategories,
		reasons,
		warnings,
		signals,
		"http_error",
		"Captured page visible text or title looks like an HTTP error page.",
		matchedTitle ? `title matched HTTP-error pattern: ${title}` : "visible text matched HTTP-error pattern",
	);
}

function detectJsLoadingFailure({ visibleText, problemCategories, reasons, warnings, signals }) {
	if (!matchesAny(visibleText, JS_LOADING_PATTERNS)) return;
	addProblem(
		problemCategories,
		reasons,
		warnings,
		signals,
		"js_loading_failure",
		"Captured page appears to be a JavaScript, cookies, or unsupported-browser loading failure.",
		"visible text matched JavaScript/cookies/browser-required pattern",
	);
}

function detectLoginOrPaywall({ visibleText, problemCategories, reasons, warnings, signals }) {
	if (!matchesAny(visibleText, LOGIN_OR_PAYWALL_PATTERNS)) return;
	addProblem(
		problemCategories,
		reasons,
		warnings,
		signals,
		"login_or_paywall",
		"Captured page appears to be a login wall, account wall, or subscription wall rather than the requested content.",
		"visible text matched login/paywall pattern",
	);
}

function detectGeoOrPolicyBlock({ visibleText, problemCategories, reasons, warnings, signals }) {
	if (!matchesAny(visibleText, GEO_OR_POLICY_BLOCK_PATTERNS)) return;
	addProblem(
		problemCategories,
		reasons,
		warnings,
		signals,
		"geo_or_policy_block",
		"Captured page appears to be blocked by region, age, policy, or access restrictions.",
		"visible text matched geo/policy-block pattern",
	);
}

function captureStatus(problemCategories, reasons) {
	if (problemCategories.includes("bot_protection")) return "likely_bot_protection";
	if (problemCategories.includes("http_error")) return "likely_http_error";
	if (problemCategories.includes("js_loading_failure")) return "likely_js_loading_failure";
	if (problemCategories.includes("login_or_paywall")) return "likely_login_or_paywall";
	if (problemCategories.includes("geo_or_policy_block")) return "likely_geo_or_policy_block";
	if (problemCategories.includes("low_content")) return "low_content";
	if (reasons.length > 0) return "unknown_suspicious";
	return "ok";
}

function confidenceFor(status, problemCategories) {
	if (status === "ok") return "none";
	if (problemCategories.includes("bot_protection")) return "high";
	if (problemCategories.includes("http_error")) return "high";
	if (problemCategories.includes("js_loading_failure")) return "medium";
	if (problemCategories.includes("login_or_paywall")) return "medium";
	if (problemCategories.includes("geo_or_policy_block")) return "medium";
	if (problemCategories.includes("low_content")) return "medium";
	return "low";
}

export function buildPageHealth(pageContext) {
	if (!pageContext) {
		return {
			pageHealth: {
				collected: false,
				capture_status: "not_collected",
				problem_categories: [],
				confidence: "none",
				signals: [],
				suspicious_blank_or_error_page: false,
				reasons: [],
			},
			warnings: [],
		};
	}

	const title = String(pageContext.title || "").trim();
	const visibleText = String(pageContext.visible_text_excerpt || "").trim();
	const headings = Array.isArray(pageContext.headings) ? pageContext.headings : [];
	const interactiveElements = Array.isArray(pageContext.interactive_elements) ? pageContext.interactive_elements : [];
	const combinedText = `${title}\n${visibleText}`;
	const reasons = [];
	const warnings = [];
	const problemCategories = [];
	const signals = [];

	function addReason(reason) {
		pushUnique(reasons, reason);
		pushUnique(warnings, reason);
	}

	if (!title) addReason("Captured page has no title.");
	if (visibleText.length === 0) {
		addProblem(
			problemCategories,
			reasons,
			warnings,
			signals,
			"low_content",
			"Captured page has no visible text excerpt.",
			"visible text is empty",
		);
	} else if (visibleText.length < 80) {
		addProblem(
			problemCategories,
			reasons,
			warnings,
			signals,
			"low_content",
			`Captured page has very little visible text (${visibleText.length} characters).`,
			`visible text length is ${visibleText.length}`,
		);
	}

	if (headings.length === 0 && interactiveElements.length === 0) {
		addReason("Captured page context has no visible headings or interactive elements.");
	}

	if (/^sorry\.?$/i.test(visibleText)) {
		addProblem(
			problemCategories,
			reasons,
			warnings,
			signals,
			"low_content",
			"Captured page visible text is only 'Sorry.', which often indicates an unavailable or blocked page.",
			"visible text is only 'Sorry.'",
		);
	} else if (/\b(access denied|blocked|captcha|forbidden|not found|server error|temporarily unavailable)\b/i.test(visibleText)) {
		addReason("Captured page visible text looks like an error, blocking, or unavailable-page message.");
	}

	detectBotProtection({ title, visibleText, combinedText, problemCategories, reasons, warnings, signals });
	detectHttpError({ title, visibleText, problemCategories, reasons, warnings, signals });
	detectJsLoadingFailure({ visibleText, problemCategories, reasons, warnings, signals });
	detectLoginOrPaywall({ visibleText, problemCategories, reasons, warnings, signals });
	detectGeoOrPolicyBlock({ visibleText, problemCategories, reasons, warnings, signals });

	const status = captureStatus(problemCategories, reasons);

	return {
		pageHealth: {
			collected: true,
			title_present: Boolean(title),
			visible_text_length: visibleText.length,
			heading_count: headings.length,
			interactive_element_count: interactiveElements.length,
			capture_status: status,
			problem_categories: problemCategories,
			confidence: confidenceFor(status, problemCategories),
			signals,
			suspicious_blank_or_error_page: status !== "ok",
			reasons,
		},
		warnings,
	};
}
