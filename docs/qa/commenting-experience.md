# Commenting experience QA — 2026-09-07

Tested through the browser against a local production frontend build, FastAPI, and an isolated PostgreSQL 17 database. The fixture contained paragraphs, nested cards, a table, an interactive button, a long page, and an independently scrolling section. All comments, users, and files were synthetic. No production writes or deployments were performed.

## Reproduced issues and changes

| Issue | Change |
| --- | --- |
| Posting a comment exits comment mode | Each mutation has its own completion action; posting clears only the submitted composer and keeps selection mode enabled. |
| Selecting a section leaves keyboard focus in the iframe | The new-comment editor receives focus automatically, including after selecting a containing element. |
| No visible connection between page and discussion | Numbered document markers match numbered thread headers; either side can open the other. |
| Resolving or replying scrolls and highlights the page again | Location changes occur on explicit navigation or initial deep link, independently of refreshes. |
| Bright, persistent section highlight | A thin, unfilled outline fades after 1.8 seconds; markers remain. Selection mode uses a separate restrained outline. |
| Switching threads loses reply drafts | Reply drafts are stored separately by thread for the lifetime of the review. Escape preserves a new-comment draft. |
| Generic action cleanup also discards unrelated work | New comments, replies, resolution, and reattachment have separate completion behavior. |
| Reattachment appears during ordinary composition | Reattachment is an explicit flow naming the thread, with no new-comment submit action. |
| After mobile posting, the document remains offscreen | Posting returns the outer review scroll area to the document. |
| A sticky filter header obscures a navigated thread | Thread navigation reserves space for the sticky header. |
| Secondary text is faint in dark mode | Comment metadata and filter counts use the theme's secondary text token. |

## Manual checks

| Scenario | Observed result |
| --- | --- |
| Post consecutive comments on different sections | Mode remains enabled; each selection focuses an empty editor. |
| Select a containing card | Anchor preview changes to the card; editor focus returns. |
| Cmd+Enter and Ctrl+Enter | Each submits one comment. |
| Escape, resume draft | Mode exits; Resume draft restores text and editor focus. |
| Open thread from document marker | Matching sidebar thread opens and receives focus. |
| Open thread from sidebar | Document scrolls to the target, briefly outlines it, then retains only the marker. |
| Reply draft, switch threads, return | Original draft remains attached to its own thread. |
| Resolve while reading elsewhere | Document remains at the reader's current position; resolved thread leaves Open. |
| Resolved filter and reopen | Resolved discussion is discoverable and can return to Open. |
| Two threads on the same section | Separate, offset numbered markers remain clickable. |
| Nested scrolling | Marker follows its target, hides when clipped, and returns when the target is revealed. |
| Ordinary document button outside comment mode | Its original click handler still runs. |
| 390×844 viewport | Selection brings the editor into view; posting brings the document back; no horizontal overflow observed. This is viewport emulation, not a physical phone test. |
| Light and dark themes | Markers, active threads, focus rings, and composer remain legible. |
| Local database outage during posting | Error displayed; section and draft retained; recovery and retry created one comment. |
| Incoming reply from a synthetic second reviewer | Reply appeared on refresh polling; active draft text and textarea focus remained intact; notification count updated. |
| Upload revised HTML | Stable unchanged card anchors remained connected; changed/uncertain anchors showed Needs reattachment. |
| Reattach changed thread to a containing card | Same thread, comment history, and number retained; new marker appeared. |
| Browser console after final reload | No warnings or errors observed. Earlier forced-outage HTTP errors were expected. |

## Automated checks

- 13 frontend/bridge tests: composition focus, persistent mode, keyboard submission, duplicate-submit lock, failed-save retention, successful write followed by failed refresh, reply draft isolation, no resolve/refresh scroll, resolved deep links, source/origin checks, minimal iframe payloads, reattachment, marker visibility/collisions, outline expiry, and preservation of original document content/interaction.
- 53 backend tests passed against a separate PostgreSQL database.
- SQLite backend run: 52 passed, 1 PostgreSQL-only test skipped.
- Frontend production build, Ruff, and whitespace checks passed.
- Frontend tests added to CI. Compatible dependency patches applied; npm reported zero vulnerabilities after installation.

## Scope and limits

- No database schema changes or migrations are needed for these UX changes.
- Drafts are held in memory, with a warning before navigation discards them; they are not saved across a reload or browser crash.
- Incoming discussions refresh every 15 seconds while visible, on window focus, or through Refresh; this is polling rather than live sockets.
- Cross-revision matching remains deliberately conservative: anchors without stable IDs may require reattachment even if similar text remains. Canvas objects and content inside nested iframes are outside the element-selection model.
- Manual browser coverage used the Codex in-app browser. Physical mobile devices and independent Safari/Firefox runs were not performed.
