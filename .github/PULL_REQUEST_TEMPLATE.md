# What

Describe what this pull request changes and why.

## Related issue

Closes #

## Decision record

Either the path to the record this change adds or implements, or
`not required - <reason>`. See [`docs/adr/README.md`](../docs/adr/README.md)
for when one is warranted.

ADR:

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] Feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation
- [ ] Tooling or CI

## Checklist

- [ ] `npm test` and `npm run format:check` pass locally.
- [ ] Commits follow Conventional Commits.
- [ ] No personal data is included (no real job-search content in fixtures or examples).
- [ ] The plugin stays dependency-free: no bare (npm) imports in plugin source, no raw network, no process spawning.
- [ ] `humanInTheLoop` is still true and the plugin still only proposes roles for the user to review.
- [ ] Documentation is updated if user-facing behavior changed.
