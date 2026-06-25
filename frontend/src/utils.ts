// Build the public "/v/..." link for a file.
//
// Each path segment is percent-encoded (spaces become %20, etc.) while the
// "/" separators are preserved. This keeps shared links intact when they're
// pasted into apps like Slack, which stop parsing a URL at the first space.
export function publicHref(path: string, name: string): string {
  const base = path === '/' ? '' : path;
  return `/v${encodeSegments(base)}/${encodeURIComponent(name)}`;
}

function encodeSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

// ─── Client-side router URLs ───────────────────────────────────────────────
// The app's navigation state lives in the browser URL so Back/Forward, deep
// links and refresh all work. Folder paths map to "/folder/<segments>" and the
// in-app file viewer maps to "/file/<segments>/<name>". These prefixes avoid
// colliding with the backend's reserved "/api" and "/v" routes and with Vite's
// hashed "/assets" output.

// Build the router URL for browsing a folder (an API-style path like "/a/b").
export function folderUrl(path: string): string {
  if (path === '/' || path === '') return '/';
  return `/folder${encodeSegments(path)}`;
}

// Build the router URL for viewing a file inside the app shell.
export function fileUrl(path: string, name: string): string {
  const base = path === '/' ? '' : path;
  return `/file${encodeSegments(base)}/${encodeURIComponent(name)}`;
}

// Turn the router splat (the "*" param, already decoded by react-router) back
// into the API-style folder path. "" -> "/", "a/b" -> "/a/b".
export function parseFolderPath(splat: string | undefined): string {
  const trimmed = (splat ?? '').replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
}

// Split the file-viewer splat into the containing folder path and file name.
// "a/b/page.html" -> { path: "/a", name: "page.html" }
export function parseFilePath(splat: string | undefined): { path: string; name: string } {
  const segments = (splat ?? '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const name = segments.pop() ?? '';
  const path = segments.length ? `/${segments.join('/')}` : '/';
  return { path, name };
}

const FOLDER_PREFIX = '/folder/';
const FILE_PREFIX = '/file/';

function decodeSplat(splat: string): string {
  return splat
    .split('/')
    .map(seg => { try { return decodeURIComponent(seg); } catch { return seg; } })
    .join('/');
}

// Which view a raw browser pathname maps to. The pathname from react-router's
// useLocation is NOT decoded, so segments are decoded here before normalizing.
export type RouteView =
  | { mode: 'folder'; path: string }
  | { mode: 'file'; path: string; name: string };

export function parseLocation(pathname: string): RouteView {
  if (pathname.startsWith(FILE_PREFIX)) {
    const { path, name } = parseFilePath(decodeSplat(pathname.slice(FILE_PREFIX.length)));
    if (name) return { mode: 'file', path, name };
    return { mode: 'folder', path };
  }
  if (pathname.startsWith(FOLDER_PREFIX)) {
    return { mode: 'folder', path: parseFolderPath(decodeSplat(pathname.slice(FOLDER_PREFIX.length))) };
  }
  return { mode: 'folder', path: '/' };
}
