# Contributing

Thanks for your interest in improving career-ops-plugin-big-boards.

## Development setup

You need Node 18 or newer.

```bash
npm install          # dev tooling only; the plugin's own runtime code stays dependency-free
npm test             # zero-network smoke test
npm run format:check # Prettier
```

The plugin must stay dependency-free at runtime, aside from the sandboxed
`ctx.fetch` calls the career-ops engine provides. The career-ops plugin
registry rejects any bare (npm) import in plugin source: use relative modules
and the allowlisted Node built-ins only (no raw network, no `child_process`).
If you add a source file, keep to that rule. `npm test` and the registry audit
both check it.

## Before you open a PR

Run these and make sure they pass:

```bash
npm test
npm run format:check
```

## Issues and branches

Open an issue before starting non-trivial work, so the approach can be agreed on
first. Branch names follow `dev/<issue-number>-<short-kebab-description>`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`,
`fix:`, `docs:`, `chore:`, and so on). Commit messages are linted in CI. Do not
add AI-authorship trailers.

## Pull requests

Keep a PR scoped to one issue. Fill in the PR template, link the issue, and make
sure CI is green. Describe what changed and how you verified it.

## Scope

This plugin does one thing: scan Apify-reachable job boards and feed curated
roles, with full job-description text, into the career-ops pipeline. It is
human-in-the-loop and never auto-submits anything. Please keep changes within
that scope.
