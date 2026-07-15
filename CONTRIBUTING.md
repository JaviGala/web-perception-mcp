# Contributing

This project is intentionally narrow: it loads or captures images, delegates visual analysis to a configured vision model, and returns grounded results through MCP.

Changes should strengthen that core without turning the repository into a general browser-automation, extraction, research-agent, or UX-audit framework. Larger experiments are better developed separately and integrated only when they prove a clear benefit.

## Development setup

```bash
npm install
npx playwright install chromium
npm test
```

`npm test` runs syntax checks, unit tests, and the Playwright screenshot tests.

Do not use real API keys in tests. Provider requests should be mocked unless a deliberately manual integration test is being performed outside the committed test suite.

### Manual provider integration tests

Keep manual tests small and reproducible:

- make real provider calls only through a fresh MCP `stdio` process; never call the provider directly from the harness;
- verify the live MCP server name and version before making provider calls;
- let the MCP server load the ignored `.env` file normally; the harness must not open, parse, copy or print it;
- never search for, inspect, log or expose credential values in the harness or report;
- when testing `.env` as the sole provider-configuration source, copy the child process environment without logging values and remove inherited provider variables by name;
- use unique temporary screenshot directories and remove all harnesses and generated images afterwards.

Manual reports, provider responses and screenshots may contain private page content. Do not commit them unless they have been deliberately reviewed and sanitised.

## Project structure

```text
src/
  server.js             MCP server and public tool definitions
  vision.js             provider client, image validation, and prompt helpers
  browser.js            Playwright launch, request safety, and screenshots
  extraction.js         compact page-context extraction
  page-health.js        capture-quality diagnostics
  paths.js              screenshot paths and cleanup
  screenshot-result.js  screenshot result normalisation
  security.js           URL validation, SSRF protection, env loading, logging

test/                   unit and Playwright tests
docs/                   focused setup and retrospective documentation
```

## Versioning and releases

The project uses semantic versioning while it remains in initial development (`0.y.z`). A version change is tied to a release, not to every pull request.

For a release:

1. Choose the appropriate patch or minor version.
2. Update `package.json` and `package-lock.json`.
3. Update the version advertised by the MCP server in `src/server.js`.
4. Run `npm test`.
5. Merge the release PR.
6. Create the matching Git tag and GitHub release, for example `v0.1.1`.

Compatible bug fixes and documentation corrections normally use a patch increment. New compatible functionality normally uses a minor increment. Breaking changes should be clearly documented; during `0.y.z`, they may still require a minor increment rather than a major one.

## Security and release hygiene

Never commit:

- `.env` files or API keys;
- MCP client configurations containing secrets;
- private screenshots or browsing-session logs;
- generated files containing credentials or private page content.

Before making a private fork or previously private history public, scan the full Git history rather than only the current working tree. Suitable tools include `gitleaks` and `trufflehog`.

After dependency changes and before a public release, review production dependency licences:

```bash
npx --yes license-checker-rseidelsohn --production --excludePrivatePackages --summary
npx --yes license-checker-rseidelsohn --production --excludePrivatePackages --onlyAllow 'MIT;MIT-0;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC'
```

The repository does not vendor npm dependencies. If it later distributes bundled dependencies, browser binaries, Docker images, or packaged applications, review the relevant notice and redistribution requirements separately. Playwright browser downloads are not committed to this source repository.

## AI-assisted development

The codebase was generated and iterated with AI coding agents under human product direction, review, and testing. Contributions produced with AI tools should be reviewed to the same standard as hand-written changes and should include focused tests for behavioural changes.

See [`docs/scope-retrospective.md`](./docs/scope-retrospective.md) for the main lessons from the broader web-perception experiment.
