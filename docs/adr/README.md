# Architecture Decision Records

Each ADR records one decision, why it was made, and what was rejected. To
change a decision, add a new ADR that supersedes the old one. Do not rewrite
history. Use [`template.md`](template.md) for new records.

| ADR                                              | Title                                                                       | Status   | Date       |
| ------------------------------------------------ | --------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-single-node-process.md)              | One Node.js process hosts HTTP, HocusPocus, and MCP                         | accepted | 2026-09-11 |
| [0002](0002-sqlite-plain-sql.md)                 | SQLite with better-sqlite3 and plain SQL, no ORM                            | accepted | 2026-09-11 |
| [0003](0003-github-api-no-clone.md)              | GitHub API only, no local clone                                             | accepted | 2026-09-11 |
| [0004](0004-one-branch-per-content-item.md)      | One content item, one branch, one pull request                              | accepted | 2026-09-11 |
| [0005](0005-drift-detection.md)                  | Detect drift with base_commit_sha, no automatic merge                       | accepted | 2026-09-11 |
| [0006](0006-mdx-opaque-blocks.md)                | Preserve unsupported MDX as opaque, read-only blocks                        | accepted | 2026-09-11 |
| [0007](0007-frontmatter-schema-inference.md)     | Infer frontmatter from content.config.ts and entries, fall back to raw YAML | accepted | 2026-09-11 |
| [0008](0008-media-storage-and-gc.md)             | Media in S3-compatible storage with reference-counted GC                    | accepted | 2026-09-11 |
| [0009](0009-minimal-authentication.md)           | Shared password sessions for browsers, static token for MCP                 | accepted | 2026-09-11 |
| [0010](0010-collaboration-scope.md)              | Collaboration is live editing, presence, and cursors only                   | accepted | 2026-09-11 |
| [0011](0011-shared-service-layer.md)             | Web UI and MCP share one service layer                                      | accepted | 2026-09-11 |
| [0012](0012-pnpm-workspaces-and-tooling.md)      | pnpm workspaces, TypeScript 7, and an isolated TypeScript for ESLint        | accepted | 2026-09-11 |
| [0013](0013-draft-storage.md)                    | Drafts are rows in SQLite, behind a repository and a service                | accepted | 2026-09-12 |
| [0014](0014-static-content-config-parsing.md)    | Parse content.config.ts with @babel/parser, never execute it                | accepted | 2026-09-12 |
| [0015](0015-editor-model-and-serialization.md)   | Editor document, serialization, and persistence are separate                | accepted | 2026-09-12 |
| [0016](0016-collaboration-service.md)            | HocusPocus runs as its own service, reached over JWT and a signed webhook   | accepted | 2026-09-12 |
| [0017](0017-media-storage.md)                    | Media in S3-compatible storage, content-addressed, metadata in SQLite       | accepted | 2026-09-12 |
| [0018](0018-images-are-editable-nodes.md)        | Images are editable nodes, and pasting one uploads it                       | accepted | 2026-09-12 |
| [0019](0019-publishing-through-pull-requests.md) | Publishing through pull requests, one branch per content item               | accepted | 2026-09-12 |
| [0020](0020-mcp-interface.md)                    | MCP on the same app, the same services, its own token                       | accepted | 2026-09-13 |
| [0021](0021-media-collection.md)                 | Media collection: three reference sources, and proof before deletion        | accepted | 2026-09-15 |
| [0022](0022-frontmatter-controls.md)             | Frontmatter edited as a YAML document, with schema-driven controls          | accepted | 2026-09-16 |
| [0023](0023-media-library.md)                    | Media library: references from a shared service, no upload, no thumbnails   | accepted | 2026-09-16 |
