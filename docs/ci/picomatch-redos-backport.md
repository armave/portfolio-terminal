# Picomatch ReDoS backport

**Status:** Temporary, source-attributed internal backport. This is not an upstream picomatch release and does not claim maintainer approval.

## Why this exists

The full development dependency audit identifies CVE-2026-112366 / GHSA-fc5q-39xc-vjpf through the picomatch 2.x and 4.x copies in the build/test toolchain. The exact-head audit before this backport reported 14 high-severity paths; the production-only audit reported zero. The advisory does not publish a patched npm version, and npm audit fix --force proposes a breaking Vite downgrade rather than a targeted fix.

The advisory describes catastrophic regular-expression backtracking in single-branch repeated extglob patterns such as +(*) and +(*a). This backport updates both installed major-version lines without downgrading Vite or weakening the full audit command.

## Upstream source and patch provenance

| Internal package | Upstream source line | Source commit | Backport proposal |
|---|---|---|---|
| @armave/picomatch-v4@4.0.8 | picomatch 4.0.7 | seeibt/picomatch@1bf0d04563cb9ce568cf36efc5f6b7187d9911d5 | [upstream PR #237](https://github.com/micromatch/picomatch/pull/237) |
| @armave/picomatch-v2@2.3.3 | picomatch 2.3.2 | sxnistxr/picomatch@f03bec2c02e46f063fbfdc161aae1d0f854b2565 | [upstream PR #246](https://github.com/micromatch/picomatch/pull/246) |

Both proposals are contributor branches, not accepted or published maintainer releases. The vendored runtime files are copied from those exact immutable commits, retain the upstream MIT license, and are identified by distinct internal package names and versions so they are not misrepresented as official npm releases.

The v4 backport collapses a safe single-branch repeated-star body so the inner star absorbs the outer repetition. The v2 backport applies the same optimization and deliberately uses the existing literal fallback when capture mode would otherwise change capture semantics. The safeguard's existing maxExtglobRecursion:false opt-out remains unchanged in the upstream source.

## Verification

src/domain/picomatchRedos.test.ts verifies:

- Vite, Vitest, tinyglobby and Rollup pluginutils 5.x resolve the v4 backport.
- The Prefresh / Rollup pluginutils 4.2.1 path resolves the v2 backport.
- Repeated-star patterns do not compile to nested unbounded quantifiers.
- Malicious non-matching input is evaluated in an isolated Node process with a hard timeout.
- Representative positive/negative matching behavior remains intact, and capture mode uses the safe fallback.

The standard full npm audit --audit-level=high and production-only audit remain enabled. A clean npm audit alone is not evidence that this backport is correct: the registry advisory does not know these internally renamed packages. The explicit source provenance, dependency-resolution assertions, and ReDoS regression tests are therefore required parts of this control. Re-check the advisory and package tree whenever either internal package changes.

## Retirement

Replace both local backports with a maintainer-published upstream release only after the fix is present in the release tarball, the advisory's affected/fixed version metadata is accurate, and the lockfile and complete test suite pass. Remove the corresponding vendor directories, overrides, lockfile links and this temporary record together.
