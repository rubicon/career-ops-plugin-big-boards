# career-ops-plugin-template

Template for a [career-ops](https://github.com/santifer/career-ops) community plugin.

## Use it

1. Click **"Use this template"** → create a repo named **`career-ops-plugin-<your-name>`**.
2. Edit `manifest.json` (set `id`/`name` to `<your-name>`, declare your `hooks`,
   `requiredEnv`, `allowedHosts`) and `index.mjs` (implement your hooks).
3. Reach the network **only** through `ctx.fetch` (the engine enforces your
   `allowedHosts` + SSRF protection). Producers return `Job[]`; the engine writes them.
4. `node test/smoke.mjs` should pass. CI runs it on every push.

## Hooks

`provider` · `ingest` · `search` · `notify` · `export` — there is no auto-submit hook.

## Publish + get approved

Open a **registry PR** against career-ops to be listed as an approved community
plugin (see [docs/PLUGINS.md](https://github.com/santifer/career-ops/blob/main/docs/PLUGINS.md)).
Users then install with `node plugins.mjs add <your-name>`.

## License

MIT
