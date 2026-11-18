# @armave/picomatch-v2 (internal backport)

Temporary internal backport of picomatch 2.3.2 with the single-branch repeated-star extglob ReDoS fix proposed in upstream contributor PR #246. Capture mode uses the safe literal fallback so the optimization does not change repeated-capture semantics.

Source: https://github.com/sxnistxr/picomatch/commit/f03bec2c02e46f063fbfdc161aae1d0f854b2565
Upstream project/license: https://github.com/micromatch/picomatch (MIT; see LICENSE).

This package is not an official picomatch release. Internal package version 2.3.3 identifies the backport only.
