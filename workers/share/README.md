# Share worker

Cloudflare Worker behind Marketing Cloud Toolkit's Share (moved here from the archived SFMC Query Saver repo on 2026-10-28).

- `POST /api/share` with `{ name, queryText }` stores those two fields in KV (`SHARE_KV`) for 24 hours under a random 128-bit id and returns `{ url }`. Browsers may call it only from an extension page (`Origin: chrome-extension://...`). Limits: body 120 KB, SQL 100,000 characters, name 200 characters.
- `GET /share/<id>` shows the SQL. The page has a strict CSP, no inline script, `noindex`, `no-store` and no referrer. The extension's `public/share-handler.js` offers to import it (on the user's click).
- Nothing about the sender (IP address, user agent, account) is stored by this code. Cloudflare's own request logs are outside it; Workers Logs is not turned on.
- Tests: `npx vitest run workers/share` from the repo root.
