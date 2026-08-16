# Architecture Decision Records

Why this plugin is shaped the way it is. `ARCHITECTURE.md` describes what the
code does and where it lives; these records carry why, what was rejected, and
what it costs.

Format is [MADR 4.0.0](https://adr.github.io/madr/), minimal template, plus
`status`, `date`, and `decision-makers` front matter from the full template.

## Records

| #                                                  | Decision                                                                      | Status   |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| [0001](0001-source-jobs-through-apify.md)          | Source jobs through Apify rather than fetching the boards directly            | accepted |
| [0002](0002-separate-engine-from-curation-core.md) | Keep the network engine and the pure curation core in separate modules        | accepted |
| [0003](0003-keyed-provider-hook-shape.md)          | Implement the provider hook as the keyed-provider object, not a bare function | accepted |
| [0004](0004-curate-in-the-plugin.md)               | Curate in the plugin, because the actor's own filters leak                    | accepted |
| [0005](0005-cache-job-descriptions-locally.md)     | Cache the job description locally and point the Job url at the cache          | accepted |
| [0006](0006-secrets-and-egress-in-host-sandbox.md) | Secrets and egress stay inside the host sandbox                               | accepted |
| [0007](0007-per-pass-failure-isolation.md)         | Per-pass failure isolation, within-run dedupe only                            | accepted |

## When to write one

Not every decision earns a record. Write one when any of these fires:

1. **Investigation cost.** The decision was established by reading source,
   running an experiment, or reverse-engineering an external contract, and a
   future maintainer cannot re-derive it from the code alone.
2. **Rejected alternative.** A plausible alternative was considered and
   rejected, and would otherwise be re-proposed later.
3. **External constraint.** An outside contract, such as the host API or the
   plugin registry, forces a shape that looks arbitrary in isolation.
4. **Reversal.** A previously recorded decision is being superseded.

The first three are judgment calls, so these always count regardless: a change
to a public API or external contract; adding or removing a required tool, host,
or platform dependency; rejecting an alternative named in an issue, PR, or
review; a change to repository process; superseding an existing record.

If none fire, the code plus `ARCHITECTURE.md` is enough. A decision that is
obvious from reading the code is not a record.

## Conventions

- One decision per file, `NNNN-kebab-slug.md`, four digits, monotonic, never
  reused.
- Status is one of `proposed`, `accepted`, `rejected`, `deprecated`,
  `superseded by NNNN`.
- Records are decision-immutable. Once accepted, the decision, its alternatives,
  and its consequences change only through a new record that supersedes this
  one. The original is never rewritten.
- Editorial fixes are allowed: typos, dead links, formatting, corrected
  citations. A fix that changes a factual claim gets a `Corrections` block at
  the end of the record with the date, what changed, and why.
- Every record cites what grounded it under `More Information`: a file path and
  line, or the external reference that was read.
- This repository is canonical. Notes kept elsewhere may link here, but are
  never the source of record.
