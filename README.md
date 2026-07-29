# MD3-Docs MCP

[![npm version](https://img.shields.io/npm/v/md3-docs-mcp?label=npm)](https://www.npmjs.com/package/md3-docs-mcp)

`MD3-Docs` is a stdio Model Context Protocol server that gives AI assistants access to
the live [Material Design 3 documentation](https://m3.material.io/). It covers
Foundations, Styles, and Components and returns the official English content as Markdown.

The server does not bundle a documentation snapshot or require a browser. It discovers the
current Material site data version, fetches the site's structured JSON, and converts text,
tables, implementation resources, links, code, and media metadata into an AI-friendly form.

## Architecture

The codebase uses a feature-driven structure:

```text
src/
├── app/                         # Application composition
├── features/
│   ├── catalog/                 # list_md3_docs
│   ├── document/                # read_md3_doc and Markdown rendering
│   ├── resources/               # MCP document resources
│   └── search/                  # search_md3_docs
├── infrastructure/
│   └── material/                # Material site client, parsers, and upstream types
├── shared/
│   ├── cache/                   # Generic TTL/LRU cache
│   ├── errors/                  # Domain error representation
│   ├── http/                    # Retrying fetch adapter
│   ├── mcp/                     # Shared MCP result helpers
│   └── pagination/              # Opaque cursors
└── index.ts                     # stdio process entrypoint
```

Features own their MCP schemas and handlers. `app` composes features, infrastructure adapts
external Material services, and `shared` contains only feature-independent utilities. Tests
mirror the same boundaries under `test/`.

## Requirements

- Node.js 24 or later
- npm, included with Node.js

[Bun](https://bun.sh/) is required only when developing from source. The application uses
standard Node.js and Web APIs and does not depend on `Bun.*` runtime features.

## Install and configure

### Run with npx (recommended)

No global installation is required. Add the following to your MCP client's configuration:

```json
{
  "mcpServers": {
    "MD3-Docs": {
      "command": "npx",
      "args": ["-y", "md3-docs-mcp@latest"]
    }
  }
}
```

The `-y` flag lets `npx` install or update the package without an interactive prompt.

### Install globally

Install the command once:

```sh
npm install --global md3-docs-mcp
```

Then configure your MCP client to run it directly:

```json
{
  "mcpServers": {
    "MD3-Docs": {
      "command": "md3-docs-mcp"
    }
  }
}
```

### Run from source

```sh
git clone https://github.com/ChouChiu/MD3-Docs-MCP.git
cd MD3-Docs-MCP
bun install --frozen-lockfile
```

Use the absolute path to the checkout as `cwd`:

```json
{
  "mcpServers": {
    "MD3-Docs": {
      "command": "bun",
      "args": ["run", "start"],
      "cwd": "/absolute/path/to/MD3-Docs-MCP"
    }
  }
}
```

## Development

Development and validation commands:

```sh
bun run dev
bun run check
bun run fix
bun run typecheck
bun run test
bun run test:live
```

`check` runs Biome formatting and lint validation followed by TypeScript type checking.
`fix` applies Biome's safe formatting, lint, and import-organization fixes.

The default tests are offline. `test:live` explicitly contacts `m3.material.io`.

## Continuous integration and releases

The code-quality workflow restores a platform-specific `node_modules` cache, performs a
frozen dependency installation, and runs Biome, TypeScript, and the offline test suite on
Node.js 24. It runs for branch pushes, pull requests, and manual dispatches. Live tests
remain opt-in and do not make CI depend on the Material site.

Releases are created from semantic version tags such as `v1.0.1`. The tag must exactly
match the version in `package.json`; after validation, the workflow publishes the
source-only package to npm and creates a GitHub Release with generated notes. It does not
produce or attach build artifacts. GitHub's standard source archives remain available.

Add a repository secret named `NPM_TOKEN` before publishing the first release. It must be
an npm granular access token with permission to publish `md3-docs-mcp`. Re-running a
partially completed release is safe: an npm version or GitHub Release that already exists
is skipped.

The server writes only MCP protocol messages to stdout. Diagnostics go to stderr.

## Tools

### `list_md3_docs`

Lists the official document directory.

```json
{
  "category": "components",
  "prefix": "components/button",
  "limit": 20
}
```

Inputs:

- `category`: optional `foundations`, `styles`, or `components`
- `prefix`: optional canonical path prefix
- `limit`: 1–100, default 50
- `cursor`: opaque cursor returned by the previous call

### `search_md3_docs`

Searches the official site and discards results outside the supported documentation scope.

```json
{
  "query": "navigation on large screens",
  "category": "components",
  "limit": 10
}
```

### `read_md3_doc`

Reads a canonical path or a clean `https://m3.material.io/` URL.

```json
{
  "path": "components/buttons/guidelines",
  "maxCharacters": 12000
}
```

You may provide `section` explicitly. Base component paths default to `Overview` when that
tab exists. Long results return an opaque `nextCursor`; pass it back with the same path and
section to continue. A cursor is rejected if the live document version changes.

All tools provide both structured MCP output and a JSON text fallback.

## Resources

Documents are also exposed as `text/markdown` resources:

```text
md3-docs://docs/components/buttons/guidelines
```

Resource listing is generated from the live sitemap. Resource reads return the complete
selected document tab; use `read_md3_doc` when pagination is preferable.

## Fetching, caching, and safety

- The sitemap, route index, searches, documents, and auxiliary resource tables use a
  five-minute in-process LRU cache with at most 256 entries.
- Identical concurrent requests share one upstream operation.
- Requests time out after ten seconds. Network failures, HTTP 429, and selected 5xx
  responses are retried once.
- Expired content is not served when a refresh fails.
- Only clean URLs on `https://m3.material.io` under `foundations`, `styles`, and
  `components` are accepted. Query strings, fragments, credentials, traversal, and
  external hosts are rejected.

If the Material site changes its unpublished structured-data layout, tools return an
`UPSTREAM_SCHEMA` error. Run `bun run test:live` to diagnose site compatibility.

## Troubleshooting

- If startup reports that `tsx` cannot be found, run `bun install` in the project directory.
- An `UPSTREAM_TIMEOUT` or `UPSTREAM_HTTP` result indicates a live-site or network failure;
  the server does not fall back to an expired document snapshot.
- An `UPSTREAM_SCHEMA` result usually means the Material site changed its internal data
  shape. Run `bun run test:live` to identify the affected endpoint.
- `CURSOR_STALE` means the live document or result set changed. Repeat the original call
  without its cursor.
- A stdio server normally prints no human-readable startup message. Inspect the MCP
  client's captured stderr for diagnostics.

## License and attribution

The MCP server source code is available under the [MIT License](LICENSE).

Material Design documentation, images, videos, trademarks, and other remotely fetched
content remain the property of their respective owners and are not covered by this
repository's license. Every document response retains its official source URL.
