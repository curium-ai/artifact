# Artifact — PRD

**Artifact** is an open-source, self-hosted web app for sharing HTML pages. Deploy your own instance, upload self-contained HTML files into a file manager, and share any file via a clean public URL.

## Requirements

1. **File manager** — A web-based file manager for browsing, uploading, and organizing `.html` files in nested folders. Supports create/rename/move/delete for both files and folders. Drag-and-drop for uploads (from OS) and for moving items between folders.

2. **In-app viewer** — Double-clicking a file renders it inside the app in a sandboxed iframe. A minimal top bar provides back navigation, copy-link, and open-in-new-tab.

3. **Public sharing** — Every file is automatically reachable at a URL derived from its path (e.g. `/v/reports/deck.html`). Visiting that URL renders **only** the HTML page — no app UI, no branding. Renaming or moving a file changes its link.

4. **Password-gated writes** — Browsing and viewing are open. All write operations (upload, delete, rename, move, create folder) require a single shared password set via environment variable. Session persists via httpOnly cookie.

5. **Replace on re-upload** — Uploading a file with the same name as an existing file silently overwrites it (atomic write).

6. **Self-hostable** — Ships with Docker Compose and Railway configs. One persistent volume, no external database, no external storage service. The real filesystem is the single source of truth.

## Scope

| In scope | Out of scope |
|---|---|
| Single self-contained `.html` files (≤10MB) | Multi-file bundles, asset folders, non-HTML files |
| Nested folders, drag-and-drop | Search, tags, versioning, file history |
| Single shared password | User accounts, teams, SSO |
| Docker Compose + Railway deploy | Vercel/serverless, Kubernetes |
| Public-by-path sharing | Per-file share tokens, access control per file |

## Stack

Python (FastAPI) backend, React (TypeScript + Vite) SPA frontend. Persistent disk volume — folders are real directories, files are real `.html` files. No database.
