# Parascape account server (LYK-930)

A small ParaBun service that gives the Designer real persistence: basic
username/password accounts and per-user page storage, all in a **local SQLite
file** — credentials and data never leave the machine.

## Run

```sh
bun run account:server          # → http://localhost:8788, db: ./parascape.sqlite
```

The Vite dev server proxies `/api` → `:8788` (see `vite.config.ts`), so the
browser talks same-origin (no CORS). Start both `bun run dev` and
`bun run account:server`; then in the Designer click **Sign in** to create an
account — your page is autosaved to your account and reloads across browsers.

Env: `PARASCAPE_ACCOUNT_PORT` (default `8788`), `PARASCAPE_DB` (default
`parascape.sqlite`). The DB file is gitignored.

## Storage

- `users(id, username, password_hash, created_at)` — passwords hashed with
  `Bun.password` (argon2id).
- `sessions(token, user_id, created_at)` — opaque bearer tokens.
- `projects(id, user_id, name, doc, updated_at)` — `doc` is the Designer page
  JSON (`{ sections, nextKey, codeOverride }`). The table is multi-project ready;
  the Designer UI currently uses one auto-created project per user (multi-project
  management lands with the multi-page work, LYK-929).

## Notes

Local dev backend only — single SQLite file, no TLS. Don't expose it publicly.
When signed out, the Designer falls back to its `localStorage`-only persistence.
