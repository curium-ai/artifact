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
