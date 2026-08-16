---
status: accepted
date: 2026-08-16
decision-makers: Dax Davis
---

# Implement the provider hook as the keyed-provider object, not a bare function

## Context and Problem Statement

The plugin uses the `provider` hook because it originates jobs rather than
consuming them. The obvious shape for a hook is a plain `async provider(ctx)`
function, and that is what was assumed at first. It is wrong: the host rejects
it. The actual contract had to be established by reading the host's source,
which is not a dependency of this repository and therefore cannot be checked
by anything in this tree.

## Considered Options

- A bare `async provider(ctx)` function
- The keyed-provider object `{ id, detect?, fetch(entry, ctx) }` that the host actually types
- A provider object with `detect()` implemented to auto-detect matching portal entries

## Decision Outcome

Chosen option: "The keyed-provider object", because it is the only shape the
host accepts. career-ops-exec's `plugins/_types.js` types `provider` as
`{ id, detect?, fetch(entry, ctx) }`, byte-identical to a core `providers/*.mjs`
Provider, and `plugins/_engine.mjs` `importHook` rejects anything else for the
`provider` kind.

`detect()` returns `null` deliberately. This is a keyed provider: it must fire
only on an explicit `provider: big-boards` entry in `portals.yml`, never by
auto-detecting a portal it happens to match.

### Consequences

- Good, because the hook loads. The bare-function shape does not.
- Good, because a single `portals.yml` row drives a full multi-title, multi-pass scan, since all configuration comes from `ctx.settings` rather than the entry.
- Bad, because `fetch` accepts an `entry` parameter it never reads, purely to satisfy the contract. This looks like dead weight without this record.
- Bad, because the contract lives in a repository this one does not depend on, so a host-side change cannot break a test here. It breaks at runtime.

## More Information

Hook export: `index.mjs:33-43`.
Host contract, read-only reference and not a dependency:
career-ops-exec `plugins/_types.js` and `plugins/_engine.mjs` (`importHook`).
