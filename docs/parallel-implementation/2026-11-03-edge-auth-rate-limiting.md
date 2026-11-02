# security: add Cloudflare edge rate limiting for auth routes

## Purpose
Reduce distributed login abuse and protect the Durable Object/PBKDF2 path with an early Worker-edge request shield.

## Confirmed starting point
- `worker.js` forwards `/api/auth/*` requests to `PORTFOLIO_STATE_DO`.
- The Durable Object already enforces a bounded per-IP limit (10 attempts/15 minutes, maximum 1,024 buckets), but rotating addresses can still reach the PBKDF2 path from many IPs.
- `wrangler.jsonc` currently has KV and Durable Object bindings but no Cloudflare Rate Limiting API binding.

## Implementation scope
- Own `worker.js`, `wrangler.jsonc`, Worker route tests and deployment/config validation only.
- Add a Cloudflare Workers Rate Limiting API binding for sensitive auth endpoints and check it before forwarding to the Durable Object.
- Use Cloudflare-provided client address metadata, combined with route/purpose; never trust client-supplied `X-Forwarded-For` or similar headers.
- Keep the existing Durable Object 10-per-15-minute limiter as the longer-window/shared-state layer.
- Return JSON 429 with `Retry-After`, CORS, `Cache-Control: no-store`, and safe response text.
- Tune for shared NAT, mobile carrier, VPN, and corporate egress addresses to avoid locking out legitimate users.
- Confirm a unique positive integer namespace ID in the actual target Cloudflare account; do not copy an example ID blindly.
- Add safe observability for rejections without logging passwords, session tokens, secrets, or unnecessary personal data.
- Local tests/dev should handle an absent binding explicitly; production deployment must prove the binding is present.

## Required tests
- Requests exceeding edge threshold are rejected before Durable Object invocation.
- Requests below threshold reach the Durable Object unchanged.
- Non-auth routes are not unintentionally throttled by the auth policy.
- 429 retains CORS, JSON, no-store, and retry headers.
- Spoofed forwarded headers cannot change the trusted client key.
- Missing binding behavior is explicit and tested.
- Existing Durable Object limiter tests remain green.
- Deployment smoke test confirms the binding exists in production.

## Acceptance
- [ ] Edge limiter executes before PBKDF2/DO work on selected auth routes.
- [ ] Wrangler config uses an account-confirmed unique namespace identifier.
- [ ] Existing Durable Object limiter remains enabled.
- [ ] Response and observability contain no sensitive data.
- [ ] Worker tests, typecheck/build, deployment dry run and production smoke test pass.

## Important Cloudflare caveat
Cloudflare documents the Workers Rate Limiting API as approximate and local to each Cloudflare location; counters propagate in the background, so requests may exceed a configured threshold. This is a coarse first shield, not a strict global quota. Retain the Durable Object limiter for the shared longer window.

Reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

