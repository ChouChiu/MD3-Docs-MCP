# MD3 Docs MCP

[![npm version](https://img.shields.io/npm/v/md3-docs-mcp?label=npm)](https://www.npmjs.com/package/md3-docs-mcp)

Live Material Design 3 documentation for MCP clients.

`md3-docs-mcp` is a stdio Model Context Protocol server that gives Codex, ChatGPT, and other
MCP clients concise access to the official English Foundations, Styles, and Components
documentation at [m3.material.io](https://m3.material.io/). It reads the live site; it does not
bundle a documentation snapshot, translate content, call another model, or use unofficial
sources.

## Tools

| Tool              | Use it for                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `browse_md3_docs` | Browse the official directory by category or canonical path prefix.                          |
| `search_md3_docs` | Search the site in natural language and get clean, ranked results.                           |
| `read_md3_doc`    | Read one document or section as semantic Markdown, with heading focus and cursor pagination. |
| `get_md3_context` | Gather several cited sources for implementation, review, or research work.                   |

`browse_md3_docs` and `search_md3_docs` return canonical paths (prefix them with
`https://m3.material.io/`); `read_md3_doc` and `get_md3_context` return full source URLs.

## Quick start

Add the server to your MCP configuration:

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

Alternatively, install it globally and use `md3-docs-mcp` as the command:

```sh
npm install --global md3-docs-mcp
```

The server communicates only over stdio. Protocol messages go to stdout and diagnostics to
stderr.

## Requirements

- Node.js 20 or later
- Network access to `https://m3.material.io`

## Behavior

- Reads the live site with a thirty-minute in-process cache keyed by the Carbon content
  version, so a content revision invalidates entries on its own; concurrent requests share
  one upstream operation.
- Warms the directory at startup (`MD3_WARMUP=0` disables it) so the first browse or search
  does not pay for the site index, main bundle, and sitemap.
- Returns line-oriented text (one entry per line, tab-separated) instead of pretty-printed
  JSON, keeps one URL per source instead of repeating it under every excerpt, and sends the
  document outline on the first page of a paginated read (or again on request, through
  `includeOutline`).
- Context gathering reads only the documents it cites, topping up when a candidate fails.
- Requests time out after ten seconds and retry transient failures once, honoring
  `Retry-After` up to ten seconds.
- Pagination breaks only between sections, content blocks, paragraphs, tables, and complete
  code fences, so rendered Markdown stays intact.
- Paths are restricted to clean official URLs under `foundations`, `styles`, and
  `components`.
- Errors are stable JSON objects with a code, message, and `retryable` flag.
- No persistent cache is written.

The Material site uses unpublished structured endpoints. If their schema changes, tools return
`UPSTREAM_SCHEMA`; the opt-in live test diagnoses compatibility.

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

The source is feature-driven: each feature owns its tool registration, service, and supporting
modules, while the live-site client and shared capabilities stay outside the features. Tests
live in `src/test/`; published packages contain compiled JavaScript in `dist/` and do not
install TypeScript or `tsx`.

Live tests contact `m3.material.io` only when `MD3_LIVE_TESTS=1`.

## License

The server source is available under the [MIT License](LICENSE). Material Design
documentation, media, trademarks, and remotely fetched content remain the property of their
respective owners and are not covered by this repository's license. All returned evidence
retains its official source URL.
