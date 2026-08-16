---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Keep the network engine and the pure curation core in separate modules

## Context and Problem Statement

Curation carries the real branching logic in this plugin: title, location, and
salary gates, dedupe, and slug generation. It is also the part most likely to
regress silently, since a filter bug produces a plausible-looking but wrong
result set rather than an error. Testing it through the code that calls Apify
would require a live account, a token, and paid actor runs for every test run.

## Considered Options

- One module handling the actor call, curation, and file writes together
- Two modules: a network and I/O engine, plus a pure curation core with no side effects
- One module, with the network call injected as a parameter for testing

## Decision Outcome

Chosen option: "Two modules", because purity is what makes curation testable at
all rather than merely mockable. `lib/scan-apify-core.mjs` performs no I/O, so
its tests need no account, no token, no network, and no injection scaffolding.
Dependency injection into a single module would still leave file writes and
network handling tangled with filter logic in one file.

### Consequences

- Good, because the curation suite runs offline and covers the filters exhaustively.
- Good, because the seam is narrow enough to check by inspection: the engine imports exactly three symbols from the core.
- Good, because the graph classifies the core as a leaf, so the boundary is verifiable rather than asserted.
- Bad, because a change spanning both concerns touches two files.

## More Information

Engine: `lib/scan-apify.mjs`. Curation core: `lib/scan-apify-core.mjs`.
The engine's import of the core is at `lib/scan-apify.mjs:34`.
Curation tests: `test/scan-apify-core.test.mjs`.
