// app.jsx — Artifact main app shell, state management, viewer, auth, settings

// ═══════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════
const MOCK_DATA = {
  '/': {
    folders: ['reports', 'demos', 'presentations'],
    files: [
      { name: 'Landing Page.html', size: '48 KB', modified: '2 hours ago' },
      { name: 'Style Guide.html', size: '124 KB', modified: '3 days ago' },
    ]
  },
  '/reports': {
    folders: [],
    files: [
      { name: 'Q4 Dashboard.html', size: '89 KB', modified: '1 day ago' },
      { name: 'Revenue Summary.html', size: '34 KB', modified: '5 days ago' },
      { name: 'User Metrics.html', size: '67 KB', modified: '1 week ago' },
    ]
  },
  '/demos': {
    folders: ['archived'],
    files: [
      { name: 'Product Tour.html', size: '156 KB', modified: '3 hours ago' },
      { name: 'Onboarding Flow.html', size: '201 KB', modified: '2 days ago' },
    ]
  },
  '/presentations': {
    folders: [],
    files: [
      { name: 'Team Offsite.html', size: '312 KB', modified: '1 week ago' },
      { name: 'Board Deck.html', size: '445 KB', modified: '2 weeks ago' },
      { name: 'Q1 Review.html', size: '267 KB', modified: '1 month ago' },
    ]
  },
  '/demos/archived': {
    folders: [],
    files: [
      { name: 'Old Demo v1.html', size: '98 KB', modified: '3 months ago' },
    ]
  },
};

// ═══════════════════════════════════════
// THEME / ACCENT CONSTANTS
// ═══════════════════════════════════════
const THEMES = [
  { id: 'light',    label: 'Light',    preview: '#F3EFEA' },
  { id: 'dark',     label: 'Dark',     preview: '#1C1C1C' },
  { id: 'midnight', label: 'Midnight', preview: '#111827' },
  { id: 'slate',    label: 'Slate',    preview: '#E8EBF0' },
  { id: 'sand',     label: 'Sand',     preview: '#F7F3ED' },
  { id: 'forest',   label: 'Forest',   preview: '#111D17' },
  { id: 'rose',     label: 'Rose',     preview: '#FDF2F4' },
];

const ACCENTS = [
  { color: '#F54E00', label: 'Orange' },
  { color: '#1D4AFF', label: 'Blue' },
  { color: '#388600', label: 'Green' },
  { color: '#8F3FCE', label: 'Purple' },
  { color: '#0D9488', label: 'Teal' },
  { color: '#E11D48', label: 'Rose' },
  { color: '#D97706', label: 'Amber' },
  { color: '#4F46E5', label: 'Indigo' },
  { color: '#0EA5E9', label: 'Sky' },
  { color: '#DC2626', label: 'Red' },
];

// ═══════════════════════════════════════
// SETTINGS POPOVER
// ═══════════════════════════════════════
function SettingsPopover({ theme, accent, onThemeChange, onAccentChange, onClose }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className="settings-popover" ref={ref}>
      <div className="settings-popover__header">
        <span className="settings-popover__title">Settings</span>
      </div>

      <div className="settings-popover__section">
        <span className="settings-popover__label">Theme</span>
        <div className="settings-popover__theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`theme-swatch ${theme === t.id ? 'theme-swatch--active' : ''}`}
              onClick={() => onThemeChange(t.id)}
              title={t.label}
            >
              <span className="theme-swatch__preview" style={{ background: t.preview }}></span>
              <span className="theme-swatch__name">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-popover__section">
        <span className="settings-popover__label">Accent color</span>
        <div className="settings-popover__accent-grid">
          {ACCENTS.map(a => (
            <button
              key={a.color}
              className={`accent-swatch ${accent === a.color ? 'accent-swatch--active' : ''}`}
              onClick={() => onAccentChange(a.color)}
              title={a.label}
            >
              <span className="accent-swatch__dot" style={{ background: a.color }}></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// FILE VIEWER
// ═══════════════════════════════════════
function FileViewer({ file, path, onBack }) {
  const toast = useToast();
  const publicUrl = `/v${path === '/' ? '' : path}/${file.name}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + publicUrl).catch(() => {});
    toast('Link copied to clipboard');
  };

  return (
    <div className="viewer">
      <div className="viewer__toolbar">
        <button className="viewer__back" onClick={onBack}>
          <ArrowLeftIcon width={16} height={16} />
          <span>Back</span>
        </button>
        <div className="viewer__filename">
          <FileHtmlIcon width={16} height={16} />
          <span>{file.name}</span>
        </div>
        <div className="viewer__actions">
          <Button size="small" icon={<CopyIcon width={15} height={15} />} onClick={handleCopyLink}>
            Copy link
          </Button>
          <Button size="small" icon={<ExternalLinkIcon width={15} height={15} />} onClick={() => toast('Would open in new tab')}>
            Open
          </Button>
        </div>
      </div>
      <div className="viewer__frame">
        <div className="viewer__mock-page">
          <div className="viewer__mock-header" style={{ background: getPreviewGradient(file.name) }}>
            <div className="viewer__mock-nav">
              <div className="viewer__mock-logo"></div>
              <div className="viewer__mock-nav-items">
                <div className="viewer__mock-nav-item"></div>
                <div className="viewer__mock-nav-item"></div>
                <div className="viewer__mock-nav-item"></div>
              </div>
            </div>
            <div className="viewer__mock-hero">
              <div className="viewer__mock-hero-title"></div>
              <div className="viewer__mock-hero-sub"></div>
              <div className="viewer__mock-hero-btn"></div>
            </div>
          </div>
          <div className="viewer__mock-body">
            <div className="viewer__mock-section">
              <div className="viewer__mock-h2"></div>
              <div className="viewer__mock-grid">
                <div className="viewer__mock-card"></div>
                <div className="viewer__mock-card"></div>
                <div className="viewer__mock-card"></div>
              </div>
            </div>
            <div className="viewer__mock-section">
              <div className="viewer__mock-h2 viewer__mock-h2--short"></div>
              <div className="viewer__mock-text-line"></div>
              <div className="viewer__mock-text-line viewer__mock-text-line--med"></div>
              <div className="viewer__mock-text-line viewer__mock-text-line--short"></div>
            </div>
          </div>
        </div>
      </div>
      <div className="viewer__url-bar">
        <LinkIcon width={14} height={14} />
        <span className="viewer__url">{publicUrl}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// PASSWORD MODAL
// ═══════════════════════════════════════
function PasswordModal({ onSuccess, onClose }) {
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = (e) => {
    e && e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      if (password === 'artifact') {
        onSuccess();
      } else {
        setError(true);
        setLoading(false);
      }
    }, 400);
  };

  return (
    <Modal title="Authentication required" onClose={onClose} width={380}>
      <p className="modal__desc">Enter the shared password to make changes.</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <Input
            type="password"
            value={password}
            onChange={v => { setPassword(v); setError(false); }}
            placeholder="Password"
            autoFocus
            className={error ? 'input-wrap--error' : ''}
          />
          {error && <p className="input-error">Incorrect password. Try again.</p>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading || !password}>
            {loading ? 'Checking…' : 'Unlock'}
          </Button>
        </div>
      </form>
      <p className="modal__hint">Hint: try "artifact"</p>
    </Modal>
  );
}

// ═══════════════════════════════════════
// NEW FOLDER MODAL
// ═══════════════════════════════════════
function NewFolderModal({ onClose, onCreate }) {
  const [name, setName] = React.useState('');
  const handleCreate = () => { if (name.trim()) { onCreate(name.trim()); onClose(); } };
  return (
    <Modal title="Create new folder" onClose={onClose} width={380}>
      <div style={{ marginBottom: 16 }}>
        <Input
          value={name}
          onChange={setName}
          placeholder="Folder name"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate} disabled={!name.trim()}>Create</Button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════
// UPLOAD MODAL
// ═══════════════════════════════════════
function UploadModal({ onClose, onUpload }) {
  const [files, setFiles] = React.useState([]);
  const [uploading, setUploading] = React.useState(false);
  const inputRef = React.useRef(null);

  const handleFiles = (fileList) => {
    const htmlFiles = Array.from(fileList).filter(f => f.name.endsWith('.html'));
    setFiles(htmlFiles);
  };

  const handleUpload = () => {
    setUploading(true);
    setTimeout(() => { onUpload(files); onClose(); }, 600);
  };

  return (
    <Modal title="Upload HTML files" onClose={onClose} width={440}>
      <div
        className="upload-drop-area"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept=".html" multiple hidden onChange={e => handleFiles(e.target.files)} />
        <UploadIcon width={28} height={28} style={{ color: 'var(--text-tertiary)' }} />
        <p className="upload-drop-area__text">Click to browse or drag files here</p>
        <p className="upload-drop-area__hint">Only .html files, max 10 MB each</p>
      </div>

      {files.length > 0 && (
        <div className="upload-file-list">
          {files.map((f, i) => (
            <div key={i} className="upload-file-item">
              <FileHtmlIcon width={14} height={14} />
              <span className="upload-file-item__name">{f.name}</span>
              <span className="upload-file-item__size">{(f.size / 1024).toFixed(0)} KB</span>
              <button className="icon-btn icon-btn--sm" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                <XIcon width={14} height={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleUpload} disabled={files.length === 0 || uploading}>
          {uploading ? 'Uploading…' : `Upload${files.length > 0 ? ` (${files.length})` : ''}`}
        </Button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════
// DELETE CONFIRMATION MODAL
// ═══════════════════════════════════════
function DeleteModal({ item, onClose, onConfirm }) {
  return (
    <Modal title={`Delete ${item.type === 'folder' ? 'folder' : 'file'}`} onClose={onClose} width={380}>
      <p className="modal__desc">
        Are you sure you want to delete <strong>{item.name}</strong>? This cannot be undone.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => { onConfirm(item); onClose(); }}>Delete</Button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════
// PERSISTENCE — store theme prefs in localStorage
// ═══════════════════════════════════════
const STORAGE_KEY = 'artifact-settings';
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { theme: 'light', accentColor: '#F54E00' };
}
function saveSettings(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
function App() {
  const saved = React.useMemo(() => loadSettings(), []);
  const [theme, setTheme] = React.useState(saved.theme);
  const [accentColor, setAccentColor] = React.useState(saved.accentColor);
  const [showSettings, setShowSettings] = React.useState(false);

  const [currentPath, setCurrentPath] = React.useState('/');
  const [viewingFile, setViewingFile] = React.useState(null);
  const [isAuth, setIsAuth] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [showNewFolder, setShowNewFolder] = React.useState(false);
  const [showUpload, setShowUpload] = React.useState(false);
  const [showDelete, setShowDelete] = React.useState(null);
  const [pendingAction, setPendingAction] = React.useState(null);
  const toast = useToast();

  const data = MOCK_DATA[currentPath] || { folders: [], files: [] };

  // Apply theme
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    saveSettings({ theme, accentColor });
  }, [theme]);

  // Apply accent color
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor);
    document.documentElement.style.setProperty('--accent-hover', accentColor);
    saveSettings({ theme, accentColor });
  }, [accentColor]);

  const requireAuth = (callback) => {
    if (isAuth) { callback(); return; }
    setPendingAction(() => callback);
    setShowPassword(true);
  };

  const handleAuthSuccess = () => {
    setIsAuth(true);
    setShowPassword(false);
    if (pendingAction) { pendingAction(); setPendingAction(null); }
  };

  const handleAction = (action, item) => {
    switch (action) {
      case 'upload':
        requireAuth(() => setShowUpload(true));
        break;
      case 'new-folder':
        requireAuth(() => setShowNewFolder(true));
        break;
      case 'delete':
        requireAuth(() => setShowDelete({ ...item, type: item.type || 'file' }));
        break;
      case 'rename':
        requireAuth(() => toast(`Rename "${item.name}" — would show inline editor`));
        break;
      case 'copy-link': {
        const path = currentPath === '/' ? '' : currentPath;
        const url = `${window.location.origin}/v${path}/${item.name}`;
        navigator.clipboard.writeText(url).catch(() => {});
        toast('Link copied to clipboard');
        break;
      }
      case 'open-tab':
        toast(`Would open "${item.name}" in a new tab`);
        break;
    }
  };

  const handleOpenFile = (file) => setViewingFile(file);

  const viewProps = {
    currentPath,
    data,
    allData: MOCK_DATA,
    onNavigate: setCurrentPath,
    onOpenFile: handleOpenFile,
    onAction: handleAction,
    isAuthenticated: isAuth,
  };

  if (viewingFile) {
    return <FileViewer file={viewingFile} path={currentPath} onBack={() => setViewingFile(null)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__left">
          <div className="app-header__logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="4" fill="var(--accent)"></rect>
              <path d="M8 7h3l1 5-1 5H8l1-5-1-5z" fill="white" opacity="0.9"></path>
              <path d="M13 7h3l1 5-1 5h-3l1-5-1-5z" fill="white" opacity="0.6"></path>
            </svg>
            <span className="app-header__title">Artifact</span>
          </div>
        </div>
        <div className="app-header__right">
          <button
            className={`auth-badge ${isAuth ? 'auth-badge--unlocked' : ''}`}
            onClick={() => isAuth ? setIsAuth(false) : setShowPassword(true)}
          >
            {isAuth ? <UnlockIcon width={14} height={14} /> : <LockIcon width={14} height={14} />}
            <span>{isAuth ? 'Unlocked' : 'Locked'}</span>
          </button>

          <div className="settings-trigger-wrap">
            <button
              className={`icon-btn ${showSettings ? 'icon-btn--active' : ''}`}
              onClick={() => setShowSettings(v => !v)}
              title="Settings"
            >
              <SettingsIcon width={17} height={17} />
            </button>
            {showSettings && (
              <SettingsPopover
                theme={theme}
                accent={accentColor}
                onThemeChange={setTheme}
                onAccentChange={setAccentColor}
                onClose={() => setShowSettings(false)}
              />
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        <ExplorerView {...viewProps} />
      </main>

      {showPassword && <PasswordModal onSuccess={handleAuthSuccess} onClose={() => { setShowPassword(false); setPendingAction(null); }} />}
      {showNewFolder && <NewFolderModal onClose={() => setShowNewFolder(false)} onCreate={name => toast(`Created folder "${name}"`)} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUpload={files => toast(`Uploaded ${files.length} file(s)`)} />}
      {showDelete && <DeleteModal item={showDelete} onClose={() => setShowDelete(null)} onConfirm={item => toast(`Deleted "${item.name}"`)} />}
    </div>
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
