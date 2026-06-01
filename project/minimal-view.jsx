// minimal-view.jsx — Variant C: Centered compact table (ultra-minimal)

function MinimalRow({ icon, name, meta, metaRight, onClick, onContextMenu, actions }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      className="min-row"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="min-row__icon">{icon}</span>
      <span className="min-row__name">{name}</span>
      <span className="min-row__meta">{meta}</span>
      <span className="min-row__meta-right">{metaRight}</span>
      <div className={`min-row__actions ${hovered ? 'min-row__actions--visible' : ''}`}>
        {actions}
      </div>
    </div>
  );
}

function MinimalView({ currentPath, data, onNavigate, onOpenFile, onAction }) {
  const [contextMenu, setContextMenu] = React.useState(null);
  const toast = useToast();

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

  const totalItems = data.folders.length + data.files.length;

  return (
    <div className="minimal">
      <div className="minimal__header">
        <div className="minimal__top-row">
          <Breadcrumb path={currentPath} onNavigate={onNavigate} />
          <div className="minimal__actions">
            <Button size="small" icon={<PlusIcon width={15} height={15} />} onClick={() => onAction('new-folder')}>
              New folder
            </Button>
            <Button size="small" variant="primary" icon={<UploadIcon width={15} height={15} />} onClick={() => onAction('upload')}>
              Upload
            </Button>
          </div>
        </div>
      </div>

      <div className="minimal__list">
        {totalItems === 0 && (
          <EmptyState
            icon={<FolderIcon width={32} height={32} />}
            title="Empty folder"
            subtitle="Upload .html files or create a subfolder"
          />
        )}

        {data.folders.map(folder => {
          const folderPath = currentPath === '/' ? `/${folder}` : `${currentPath}/${folder}`;
          return (
            <MinimalRow
              key={folder}
              icon={<FolderIcon width={16} height={16} style={{ color: 'var(--accent)' }} />}
              name={folder}
              meta=""
              metaRight=""
              onClick={() => onNavigate(folderPath)}
              onContextMenu={e => handleContextMenu(e, { name: folder, type: 'folder' }, 'folder')}
              actions={
                <button className="icon-btn" onClick={e => { e.stopPropagation(); handleContextMenu(e, { name: folder, type: 'folder' }, 'folder'); }}>
                  <MoreIcon width={15} height={15} />
                </button>
              }
            />
          );
        })}

        {data.folders.length > 0 && data.files.length > 0 && <div className="min-divider"></div>}

        {data.files.map(file => (
          <MinimalRow
            key={file.name}
            icon={<FileHtmlIcon width={16} height={16} style={{ color: 'var(--text-secondary)' }} />}
            name={file.name}
            meta={file.size}
            metaRight={file.modified}
            onClick={() => onOpenFile(file)}
            onContextMenu={e => handleContextMenu(e, file, 'file')}
            actions={
              <>
                <button className="icon-btn" title="Copy link" onClick={e => { e.stopPropagation(); onAction('copy-link', file); }}>
                  <LinkIcon width={14} height={14} />
                </button>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); handleContextMenu(e, file, 'file'); }}>
                  <MoreIcon width={15} height={15} />
                </button>
              </>
            }
          />
        ))}
      </div>

      {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

Object.assign(window, { MinimalView });
