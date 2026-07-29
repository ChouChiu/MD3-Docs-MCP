# MD3 Docs MCP

[![npm version](https://img.shields.io/npm/v/md3-docs-mcp?label=npm)](https://www.npmjs.com/package/md3-docs-mcp)

`MD3 Docs` is a stdio Model Context Protocol server for the live
[Material Design 3 documentation](https://m3.material.io/). It gives Codex, ChatGPT, and
other MCP clients concise access to official English Foundations, Styles, and Components
content.

Version 2 adds task-focused context gathering, semantic Markdown pagination, explicit
structured output schemas, clean search results, and source citations. The server does not
bundle a documentation snapshot, translate content, call another model, or use unofficial
sources.

## Requirements

- Node.js 20 or later
- Network access to `https://m3.material.io`

## Configure

The recommended setup runs the latest published package through `npx`:

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

Alternatively, install it globally:

```sh
npm install --global md3-docs-mcp
```

Then use `md3-docs-mcp` as the MCP server command.

The server communicates only over stdio. Protocol messages are written to stdout and
diagnostics to stderr.

## Tools

### `browse_md3_docs`

Browse the official directory by category or canonical path prefix.

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
- `cursor`: opaque cursor from the preceding page

Directory entries include their title, path, category, available sections, description,
updated date, and official source URL.

### `search_md3_docs`

Search the official site using natural language.

```json
{
  "query": "navigation on large screens",
  "category": "components",
  "limit": 10
}
```

Search results are deduplicated and cleaned of HTML and site-navigation noise. Each result
contains a stable rank, canonical path, optional section, concise snippet, and source URL.

### `read_md3_doc`

Read one canonical path or clean `https://m3.material.io/` URL.

```json
{
  "path": "components/buttons/guidelines",
  "heading": "Placement",
  "maxCharacters": 12000
}
```

Inputs:

- `path`: canonical path or official URL
- `section`: optional section name when it is not already present in the path
- `heading`: optional exact heading within the selected section
- `maxCharacters`: 1,000–30,000, default 12,000
- `cursor`: opaque semantic-page cursor

Pagination happens between sections, content blocks, paragraphs, tables, and complete code
fences. It never slices the response at an arbitrary character offset. The result reports
available sections and headings, page and block ranges, media metadata, the live content
version, and whether more pages remain.

### `get_md3_context`

Gather several official sources for one task in a single call.

```json
{
  "task": "Implement and review navigation for a large-screen mail app",
  "mode": "implementation",
  "paths": ["components/navigation-rail/guidelines"],
  "maxSources": 5,
  "maxCharacters": 20000
}
```

Inputs:

- `task`: the implementation, review, or research question
- `mode`: `implementation`, `review`, or `research`; default `research`
- `paths`: up to five optional sources that must be considered first
- `category`: optional documentation category
- `maxSources`: 1–8, default 5
- `maxCharacters`: 4,000–40,000, default 20,000

The tool combines pinned paths, official search results, and directory matches. It loads
candidate documents concurrently and ranks intact semantic blocks by task relevance:

- `implementation` prioritizes Guidelines, Specs, Overview, and Accessibility.
- `review` prioritizes Guidelines and Accessibility and adds a cited review checklist.
- `research` follows query relevance without imposing a workflow-specific section order.

Context excerpts use source labels such as `[S1]`; the structured result maps every label to
its official URL. A failed candidate becomes a warning when other evidence is available.
The tool returns an error only when it cannot produce any usable official evidence.

The character budget applies to the Markdown body, not protocol metadata.

## Errors

Tool errors are JSON objects with a stable code, message, and `retryable` flag. Relevant
codes include:

- `INVALID_PATH` and `INVALID_REQUEST`
- `NOT_FOUND`
- `CURSOR_INVALID` and `CURSOR_STALE`
- `UPSTREAM_HTTP`, `UPSTREAM_TIMEOUT`, and `UPSTREAM_SCHEMA`

Paths are restricted to clean official URLs under `foundations`, `styles`, and `components`.
Credentials, query strings, fragments, traversal, ambiguous separators, and external hosts
are rejected.

## Fetching and caching

- The site index, directory, search pages, raw documents, semantic documents, rendered
  resources, and context dependencies use five-minute in-process LRU caches.
- Identical concurrent requests share one upstream operation.
- Context documents and auxiliary resource tables load with a concurrency limit of four.
- Requests time out after ten seconds.
- Network failures, HTTP 429, and selected 5xx responses retry once with exponential jitter.
  `Retry-After` is honored up to ten seconds.
- Expired content is not served when refresh fails, and no persistent cache is written.

The Material site uses unpublished structured endpoints. If their schema changes, tools
return `UPSTREAM_SCHEMA`; the opt-in live test diagnoses compatibility.

## Development

```sh
git clone https://github.com/ChouChiu/MD3-Docs-MCP.git
cd MD3-Docs-MCP
bun install --frozen-lockfile
bun run check
bun run test
bun run test:live
bun run build
```

Development uses Bun for dependency and script management. Published packages contain
compiled JavaScript in `dist/`; runtime users do not install TypeScript or `tsx`.

The source is feature-driven:

```text
src/
├── app/                    # Server composition
├── features/
│   ├── catalog/            # browse_md3_docs
│   ├── context/            # get_md3_context and evidence ranking
│   ├── document/           # semantic model, rendering, and read_md3_doc
│   └── search/             # search_md3_docs
├── infrastructure/
│   └── material/           # Live Material site client and parsers
└── shared/                 # Cache, HTTP, errors, cursors, concurrency, version
```

Offline tests cover protocol contracts, semantic pagination, ranking, caching, retries,
compiled CLI startup, and the packed npm artifact. Live tests contact `m3.material.io`
only when `MD3_LIVE_TESTS=1`.

## Migrating from v1

Version 2 is intentionally incompatible:

- `list_md3_docs` is replaced by `browse_md3_docs`.
- `read_md3_doc` uses semantic pages instead of character offsets and has a new cursor shape.
- Search and read tools return explicit v2 structured output.
- `get_md3_context` is new.
- MCP Resources and `md3-docs://` URIs are removed.
- The minimum runtime changes from Node.js 24 to Node.js 20.

Remove stored v1 cursors when upgrading. Tool clients should rediscover schemas after
restarting the server.

## Release

Semantic version tags such as `v2.0.0` must match `package.json`. CI validates formatting,
types, offline tests, the compiled CLI, and npm package contents before publication.
Releases publish only `dist/`, the README, license, and package metadata. The compiled
`dist/index.js` contains the Node.js shebang and serves directly as the npm executable.

## License and attribution

The server source is available under the [MIT License](LICENSE).

Material Design documentation, media, trademarks, and remotely fetched content remain the
property of their respective owners and are not covered by this repository's license. All
returned evidence retains its official source URL.
