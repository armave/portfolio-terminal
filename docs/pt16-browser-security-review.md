# PT-16 — Browser security, CSP and XSS review

**Status:** Initial code-informed review and implementation plan; not a penetration test or security certification.  
**Tracking:** [#552 — CSP, XSS and browser credential exposure](https://github.com/armave/portfolio-terminal/issues/552), parent [#546 — PT-16 security lifecycle](https://github.com/armave/portfolio-terminal/issues/546).

## 1. Hosting and response-header boundary

The README identifies the hosted client as GitHub Pages. The Cloudflare Worker is a separate API origin. Worker CORS/origin handling does not set security headers on the GitHub Pages HTML document.

The current `index.html` contains viewport/theme metadata, an injected startup-critical inline style and a same-origin module entry, but no Content-Security-Policy meta element. The Vite build injects the startup-critical CSS block into the HTML. The repository does not establish a custom static-host response-header configuration for GitHub Pages.

Consequences:

- Do not assume Worker response headers protect the static app document.
- Do not copy a Cloudflare Pages `_headers` recipe into a GitHub Pages deployment and claim it is active.
- A CSP report-only response header requires a host capable of setting that response header. A CSP meta element is an enforcement mechanism, not a substitute for report-only rollout.
- A strict policy must account for the inline startup-critical style, Preact style attributes, same-origin lazy-loaded chunks, the Worker API, optional Gist sync and any direct provider connections actually used by the current build.

## 2. Content Security Policy design sequence

Before choosing a policy:

1. Enumerate script, style, font, image, connect, worker, frame and media destinations from the production artifact and source transport clients.
2. Confirm whether any direct provider connections remain in the browser or whether they are routed through the Worker.
3. Identify inline scripts/styles and style attributes emitted by the application and build.
4. Record the exact production host and any supported custom deployment origin.
5. Choose an enforcement mechanism that is actually supported by that host.

Candidate policy principles (not yet an enforceable policy):

- Prefer `default-src 'self'` with narrowly enumerated resource directives.
- Avoid broad wildcard hosts and unrestricted `https:` source expressions.
- Keep `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'` where compatible with the selected delivery mechanism.
- Do not add `unsafe-eval`.
- Do not weaken `script-src` or `style-src` globally merely to make a test green. Evaluate hashes/nonces or the smallest required inline-style exception against actual build output.
- Define `connect-src` from measured endpoints, not guessed provider names.
- Re-run browser journeys for authentication, portfolio sync, market data, Gemini, Gist and WebSocket-backed features after each policy change.

No policy should be activated until a host-compatible rollout, violation review and rollback method are demonstrated.

## 3. XSS and untrusted-content surfaces

| Surface | Current evidence | Required control/test |
|---|---|---|
| News headline/summary | `MarketNewsArticleDialog` renders article text as Preact text children, not injected HTML | Preserve direct text-child interpolation; AST regression checks the headline/body JSX nodes and rejects raw-HTML DOM sinks. A browser-level active-origin XSS test remains separate |
| News article URL | Provider-supplied URL is used as an external anchor destination | Allow only absolute HTTP(S), reject executable/non-web schemes and credential-bearing URLs; retain `noopener noreferrer` |
| Stocktwits stream URL | Provider-supplied `streamUrl` was rendered directly as an external anchor | Validate through the existing absolute HTTP(S)-only URL boundary; suppress the link for unsafe/malformed destinations; retain `noopener noreferrer` |
| Imported backup data | JSON passes a validation/normalization boundary before the store commit | Test hostile strings and malformed structures remain data, never executable markup |
| Provider errors | Error messages can originate outside the application | Render bounded, escaped text; never treat error text as markup |
| AI/news prompt context | Provider text and article bodies are untrusted input | Keep it in an untrusted-content section; prompt-injection tests must not grant financial mutation authority |
| Dynamic links and media | External URLs are assembled from provider/client values in multiple features | Inventory every `href`, `src`, iframe, navigation and window-opening sink; apply URL scheme allowlists at the boundary |

A focused article-link implementation is tracked in [PR #564](https://github.com/armave/portfolio-terminal/pull/564). That change rejects non-HTTP(S) article URLs. It is a partial mitigation, not completion of the full XSS audit.

The Margin Intelligence source-card URL sink also uses the same HTTP(S)-only validator and safe external-link attributes in [PR #581](https://github.com/armave/portfolio-terminal/pull/581). The Stocktwits community-feed link now uses the same validated destination boundary and suppresses unsafe provider-supplied URLs in [PR #627](https://github.com/armave/portfolio-terminal/pull/627). These bounded fixes close those link paths only; they do not complete the broader active-origin credential or CSP review.

The follow-up regression suite in [the URL safety tests](../src/features/quotes/marketInsightsContent.test.ts) exercises absolute HTTP(S) acceptance and rejection of executable/non-web schemes, protocol-relative and malformed destinations, embedded credentials, non-string values, and overlong input. This protects the existing URL boundary; it does not replace the broader href/src/navigation sink audit or the CSP and account-lifecycle review.

The company-news dialog now has a TypeScript-AST regression in [`MarketNewsArticleDialog.security.test.ts`](../src/components/MarketNewsArticleDialog.security.test.ts), delivered by [PR #629](https://github.com/armave/portfolio-terminal/pull/629). It identifies the labelled headline and article-body JSX elements, verifies provider-controlled values remain direct Preact text-child expressions, and rejects raw HTML insertion APIs in that component. This is a source-structure regression, not a browser penetration test or proof against an actively compromised origin; the broader hostile-content browser journey and credential review remain open.

## 4. Browser credential exposure

Observed storage and deployment documentation identifies:

- Provider API keys in browser localStorage.
- Gemini key in sessionStorage.
- An optional encrypted Gist auxiliary provider-key file; the README says the Gemini key and GitHub PAT are not stored in the Gist payload.
- Gateway/session secret storage protected by a non-extractable IndexedDB device key where supported.
- TradeNet login credentials as Worker secrets and short-lived broker SID retained in Worker/DO memory.

Controls to verify:

- No credentials or session tokens in DOM text, query strings, fragments, analytics, console output or external link destinations.
- No sensitive request headers copied to error messages or browser-visible diagnostics.
- Logout, account switching, password changes and session revocation clear or invalidate account-scoped in-memory data and key grants.
- A non-extractable device key protects stored ciphertext but does not protect credentials while the trusted origin is actively compromised or executing malicious script.
- Provider-key removal and revocation instructions are available to the user; local clearing does not automatically revoke a key at its provider.

## 5. Security regression matrix

| Area | Required regression |
|---|---|
| XSS | Script tags, event-handler attributes, SVG payloads, malformed HTML and hostile Markdown render inert |
| URL schemes | `javascript:`, `data:`, `file:`, protocol-relative and malformed destinations are rejected where only web links are intended |
| Credentials | Secret values never appear in DOM, URL, console or captured network destination |
| CSP | Production artifact and all required app journeys work under the final policy without broad wildcard exceptions |
| Navigation | External links open with safe target/rel behavior and cannot execute an inline script |
| Account lifecycle | Logout and account switching do not expose the previous account's in-memory data or credentials |
| AI injection | Untrusted article/prompt instructions cannot change system policy or execute financial mutations |

## 6. Open work and release gates

- Produce a source/production-artifact endpoint inventory before specifying `connect-src`.
- Determine a static-host response-header strategy or an approved hosting change for report-only CSP.
- Decide the minimal inline-style strategy compatible with Vite's startup-critical CSS.
- Audit all external URL and HTML sinks beyond the news dialog.
- Complete credential inventory and session/account-switch browser tests.
- Verify exact-head CI, production browser journeys and security scans.
- Obtain security review before enforcing CSP or changing hosting/deployment configuration.

**This review does not claim CSP is deployed, that all XSS sinks have been audited, or that browser credentials are protected from an active same-origin compromise.**
