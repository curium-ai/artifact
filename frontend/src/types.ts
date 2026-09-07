export interface FileItem {
  name: string;
  size: string;
  modified: string;
  bytes: number;
}

export interface DirectoryListing {
  folders: string[];
  files: FileItem[];
}

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

export interface AuthStatus {
  authenticated: boolean;
  maxFileBytes: number;
  userId?: string;
  authMode: 'password' | 'google';
  googleClientId?: string;
  allowedDomain?: string;
  email?: string;
}

export interface ArtifactDetail { id: string; path: string; revisionId: string; userId: string; ownerId: string | null }
export interface Anchor { selector: string; text: string; tag: string; elementId: string; stableId: string }
export interface CommentThread {
  id: string; revisionId: string; anchor: Anchor; resolved: boolean; authorId: string;
  comments: { id: string; author: string; authorId: string; body: string; createdAt: number }[];
}
export interface AppNotification {
  id: string; actor: string; body: string; read: boolean; artifactId: string; path: string; threadId: string; createdAt: number;
}
