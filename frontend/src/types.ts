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
  authMode: 'password' | 'google';
  googleClientId?: string;
  allowedDomain?: string;
  email?: string;
}
