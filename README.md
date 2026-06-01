# Artifact

A tiny self-hosted file sharing app for HTML prototypes. Upload `.html` files, organise them into folders, and share a clean public link — no accounts, no analytics, no third parties.

Built as a lightweight alternative to dropping prototypes into Vercel/Netlify when all you want is a stable URL to send someone.

## How it works

- **Admin side** (password-gated): browse, upload, rename, move, and delete HTML files in a folder tree. Three view modes — gallery, explorer, minimal.
- **Public side** (no auth): anyone with a link to `/v/<path>/<file>.html` can view the file. Folder listings and the admin UI stay private.

## Stack

- **Backend** — FastAPI (Python 3.12), session cookies in-memory, files on disk
- **Frontend** — React + TypeScript + Vite
- **Deploy** — single Docker image, multi-stage build

## Run it

### Docker (recommended)

```bash
ARTIFACT_PASSWORD=your-password docker compose up --build
```

App is at `http://localhost:3000`. Uploads persist to `./data`.

### Local dev

Backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ARTIFACT_PASSWORD` | `artifact` | Admin login password |
| `ARTIFACT_UPLOAD_DIR` | `backend/uploads` | Where uploaded files live |
| `ARTIFACT_FRONTEND_DIR` | `frontend/dist` | Built frontend assets to serve |

Uploads are capped at 10MB per file and restricted to `.html`.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Exchange password for a session cookie |
| `POST` | `/api/auth/logout` | — | Clear session |
| `GET` | `/api/auth/status` | — | Check session |
| `GET` | `/api/files?path=/x` | — | List folder contents |
| `GET` | `/api/tree` | — | Full folder tree |
| `POST` | `/api/files/upload` | ✓ | Upload `.html` files |
| `POST` | `/api/folders` | ✓ | Create folder |
| `POST` | `/api/files/rename` | ✓ | Rename file or folder |
| `POST` | `/api/files/move` | ✓ | Move file or folder |
| `DELETE` | `/api/files` | ✓ | Delete file or folder |
| `GET` | `/v/<path>` | — | Public render of an HTML file |

## Layout

```
backend/        FastAPI app (single file)
frontend/       React + Vite UI
project/        Original HTML/JSX design prototypes (kept for reference)
chats/          Design handoff transcripts
Dockerfile      Multi-stage build
docker-compose.yml
```

## Notes

- Session tokens are in-memory — restarting the server logs everyone out.
- CORS is open (`*`) for dev convenience; tighten it before exposing publicly.
- Path traversal is blocked at the API layer (`resolve_path`).
