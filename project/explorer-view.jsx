// explorer-view.jsx — Variant A: Sidebar + List (classic file manager)

function SidebarTreeItem({ name, path, currentPath, onNavigate, folders, allData, depth = 0 }) {
  const isActive = currentPath === path;
  const isParent = currentPath.startsWith(path + '/') || (path === '/' && currentPath !== '/');
  const [expanded, setExpanded] = React.useState(isActive || isParent);
  const subfolders = (allData[path] && allData[path].folders) || [];
  const hasChildren = subfolders.length > 0;

  React.useEffect(() => {
    if (isActive || isParent) setExpanded(true);
  }, [isActive, isParent]);

  return (
    <div>
      <button
        className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => { onNavigate(path); setExpanded(true); }}
      >
        <span className="sidebar-item__chevron" onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
          {hasChildren ? (expanded ? <ChevronDownIcon width={14} height={14} /> : <ChevronRightIcon width={14} height={14} />) : <span style={{ width: 14 }}></span>}
        </span>
        {isActive || isParent ? <FolderOpenIcon width={16} height={16} style={{ color: 'var(--accent)', flexShrink: 0 }} /> : <FolderIcon width={16} height={16} style={{ flexShrink: 0 }} />}
        <span className="sidebar-item__name">{name}</span>
      </button>
      {expanded && hasChildren && subfolders.map(sub => {
        const subPath = path === '/' ? `/${sub}` : `${path}/${sub}`;
        return (
          <SidebarTreeItem
            key={sub}
            name={sub}
            path={subPath}
            currentPath={currentPath}
            onNavigate={onNavigate}
            allData={allData}
            depth={depth + 1}
          />
        );
      })}
    </div>
  );
}

function ExplorerView({ currentPath, data, allData, onNavigate, onOpenFile, onAction, isAuthenticated }) {
  const [contextMenu, setContextMenu] = React.useState(null);
  const [sortBy, setSortBy] = React.useState('name');
  const [sortDir, setSortDir] = React.useState('asc');

  const handleSort = (field) => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
  };

  const sortedFiles = React.useMemo(() => {
    if (!data) return [];
    const files = [...data.files];
    files.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
      if (sortBy === 'size') return dir * (parseInt(a.size) - parseInt(b.size));
      return 0;
    });
    return files;
  }, [data, sortBy, sortDir]);

  const handleContextMenu = (e, item, type) => {
    e.preventDefault();
    const items = [
      { label: 'Copy link', icon: <LinkIcon width={14} height={14} />, action: () => onAction('copy-link', item) },
      ...(type === 'file' ? [{ label: 'Open in new tab', icon: <ExternalLinkIcon width={14} height={14} />, action: () => onAction('open-tab', item) }] : []),
      { divider: true },
      { label: 'Rename', icon: <EditIcon width={14} height={14} />, action: () => onAction('rename', item) },
      { label: 'Delete', icon: <TrashIcon width={14} height={14} />, action: () => onAction('delete', item), danger: true },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  if (!data) return null;

  const SortArrow = ({ field }) => {
    if (sortBy !== field) return null;
    return <span style={{ marginLeft: 4, opacity: 0.5 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="explorer">
      <div className="explorer__sidebar">
        <div className="explorer__sidebar-header">
          <span className="explorer__sidebar-label">Folders</span>
        </div>
        <div className="explorer__sidebar-tree">
          <SidebarTreeItem
            name="/"
            path="/"
            currentPath={currentPath}
            onNavigate={onNavigate}
            allData={allData}
            depth={0}
          />
        </div>
      </div>
      <div className="explorer__content">
        <div className="explorer__toolbar">
          <Breadcrumb path={currentPath} onNavigate={onNavigate} />
          <div className="explorer__toolbar-actions">
            <Button size="small" icon={<PlusIcon width={15} height={15} />} onClick={() => onAction('new-folder')}>
              New folder
            </Button>
            <Button size="small" variant="primary" icon={<UploadIcon width={15} height={15} />} onClick={() => onAction('upload')}>
              Upload
            </Button>
          </div>
        </div>
        <div className="explorer__table-wrap">
          <table className="explorer__table">
            <thead>
              <tr>
                <th className="explorer__th explorer__th--name" onClick={() => handleSort('name')}>
                  Name <SortArrow field="name" />
                </th>
                <th className="explorer__th explorer__th--size" onClick={() => handleSort('size')}>
                  Size <SortArrow field="size" />
                </th>
                <th className="explorer__th explorer__th--modified">Modified</th>
                <th className="explorer__th explorer__th--actions"></th>
              </tr>
            </thead>
            <tbody>
              {data.folders.map(folder => {
                const folderPath = currentPath === '/' ? `/${folder}` : `${currentPath}/${folder}`;
                return (
                  <tr key={folder} className="explorer__row explorer__row--folder"
                    onClick={() => onNavigate(folderPath)}
                    onContextMenu={e => handleContextMenu(e, { name: folder, type: 'folder' }, 'folder')}
                  >
                    <td className="explorer__td explorer__td--name">
                      <FolderIcon width={16} height={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <span>{folder}</span>
                    </td>
                    <td className="explorer__td explorer__td--size">—</td>
                    <td className="explorer__td explorer__td--modified">—</td>
                    <td className="explorer__td explorer__td--actions">
                      <button className="icon-btn" onClick={e => { e.stopPropagation(); handleContextMenu(e, { name: folder, type: 'folder' }, 'folder'); }}>
                        <MoreIcon width={16} height={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {sortedFiles.map(file => (
                <tr key={file.name} className="explorer__row explorer__row--file"
                  onDoubleClick={() => onOpenFile(file)}
                  onContextMenu={e => handleContextMenu(e, file, 'file')}
                >
                  <td className="explorer__td explorer__td--name">
                    <FileHtmlIcon width={16} height={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                    <span>{file.name}</span>
                  </td>
                  <td className="explorer__td explorer__td--size">{file.size}</td>
                  <td className="explorer__td explorer__td--modified">{file.modified}</td>
                  <td className="explorer__td explorer__td--actions">
                    <button className="icon-btn" onClick={e => { e.stopPropagation(); handleContextMenu(e, file, 'file'); }}>
                      <MoreIcon width={16} height={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {data.folders.length === 0 && data.files.length === 0 && (
                <tr><td colSpan={4}>
                  <EmptyState
                    icon={<FolderIcon width={32} height={32} />}
                    title="This folder is empty"
                    subtitle="Upload HTML files or create a subfolder"
                  />
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

Object.assign(window, { ExplorerView });
