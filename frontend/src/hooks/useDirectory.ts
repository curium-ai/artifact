import { useState, useEffect, useRef, useCallback } from 'react';
import type { FileItem, TreeNode } from '../types';
import * as api from '../api';

export type DirectoryStatus = 'loading' | 'ready' | 'not-found' | 'error';

export interface DirectoryState {
  folders: string[];
  files: FileItem[];
  tree: TreeNode[];
  status: DirectoryStatus;
  reload: () => void;
}

// Owns loading of a folder's contents (listing + sidebar tree) for the current
// path. Guards against the navigation race that made fast clicks show the wrong
// folder: every load gets a monotonically increasing sequence number and an
// AbortController, and a response is applied ONLY if its sequence is still the
// latest. Stale (slower, earlier) responses are discarded instead of clobbering
// the view the user actually navigated to.
export function useDirectory(currentPath: string, enabled: boolean): DirectoryState {
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [status, setStatus] = useState<DirectoryStatus>('loading');
  const [reloadToken, setReloadToken] = useState(0);

  const seq = useRef(0);

  const reload = useCallback(() => setReloadToken(t => t + 1), []);

  useEffect(() => {
    if (!enabled) return;

    const mySeq = ++seq.current;
    const controller = new AbortController();
    setStatus('loading');

    Promise.all([
      api.listFiles(currentPath, controller.signal),
      api.getTree('/', controller.signal),
    ])
      .then(([listing, treeData]) => {
        if (mySeq !== seq.current) return; // a newer navigation won — discard
        setFolders(listing.folders);
        setFiles(listing.files);
        setTree(treeData.tree);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (mySeq !== seq.current) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const aborted = err instanceof Error && err.name === 'AbortError';
        if (aborted) return;
        const apiErr = err as api.ApiError;
        if (apiErr?.status === 404) setStatus('not-found');
        else setStatus('error');
      });

    return () => controller.abort();
  }, [currentPath, enabled, reloadToken]);

  return { folders, files, tree, status, reload };
}
