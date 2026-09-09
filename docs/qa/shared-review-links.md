# Shared review links

Validated locally September 9, 2026. Production remained read-only.

## Behavior

- Existing `/v/<path>` URLs open the review interface, including links already shared by the file browser and MCP.
- Signed-in readers are directed to the stable artifact review URL.
- Signed-out readers retain the requested directory and filename in the URL while signing in; the app then opens that document with comments.
- The file menu labels its action “Copy review link”. The viewer continues copying `/a/<artifact-id>` links.
- `/raw/<path>` explicitly serves the original HTML with its existing sandbox and deployment authentication policy. No guest commenting or broader account access was added.

## Verification

An isolated local app used a disposable SQLite database and a synthetic HTML fixture. In the browser, opened `/v/sankalp/classifier-luna-report.html` while signed out, authenticated using the local test password, selected a section, and posted a comment. Reopened its stable `/a/` link and verified the comment persisted. The same post-login SPA state is used by Google login; Google-mode backend redirect/access behavior is covered by tests, without changing production sessions.

Backend: 55 tests passed, one PostgreSQL-only test skipped locally. Ruff passed. Frontend: 19 tests passed and TypeScript/Vite build passed. New tests check signed-in redirects, encoded filenames through login, anonymous access boundaries, invalid paths, and the exact URL written by Copy review link. Existing original-file response tests now exercise `/raw/`.

No database migration is required. Deploying is required before production links change behavior.
