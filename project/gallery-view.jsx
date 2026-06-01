// gallery-view.jsx — Variant B: Card grid (visual / design-tool feel)

function FileCard({ file, onClick, onContextMenu }) {
  return (
    <div className="file-card" onClick={onClick} onContextMenu={onContextMenu}>
      <div className="file-card__preview" style={{ background: getPreviewGradient(file.name) }}>
        <div className="file-card__preview-inner">
          <div className="file-card__mock-line file-card__mock-line--title"></div>
          <div className="file-card__mock-line file-card__mock-line--short"></div>
          <div className="file-card__mock-blocks">
            <div className="file-card__mock-block"></div>
            <div className="file-card__mock-block"></div>
          </div>
          <div className="file-card__mock-line file-card__mock-line--med"></div>
          <div className="file-card__mock-line file-card__mock-line--long"></div>
        </div>
      </div>
      <div className="file-card__info">
        <div className="file-card__name-row">
          <FileHtmlIcon width={14} height={14} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <span className="file-card__name">{file.name.replace('.html', '')}</span>
        </div>
        <span className="file-card__meta">{file.size} · {file.modified}</span>
      </div>
    </div>
  );
}

function FolderCard({ name, onClick, onContextMenu }) {
  return (
    <div className="file-card file-card--folder" onClick={onClick} onContextMenu={onContextMenu}>
      <div className="file-card__preview file-card__preview--folder">
        <FolderIcon width={36} height={36} />
      </div>
      <div className="file-card__info">
        <div className="file-card__name-row">
          <FolderIcon width={14} height={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span className="file-card__name">{name}</span>
        </div>
        <span className="file-card__meta">Folder</span>
      </div>
    </div>
  );
}

function DropZone({ onDrop }) {
  const [dragging, setDragging] = React.useState(false);
  return (
    <div
      className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); onDrop && onDrop(); }}
    >
      <UploadIcon width={24} height={24} />
      <span className="drop-zone__text">Drop .html files here to upload</span>
      <span className="drop-zone__hint">or click Upload above</span>
    </div>
  );
}

function GalleryView({ currentPath, data, onNavigate, onOpenFile, onAction }) {
  const [contextMenu, setContextMenu] = React.useState(null);

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
    <div className="gallery">
      <div className="gallery__toolbar">
        <Breadcrumb path={currentPath} onNavigate={onNavigate} />
        <div className="gallery__toolbar-actions">
          <Button size="small" icon={<PlusIcon width={15} height={15} />} onClick={() => onAction('new-folder')}>
            New folder
          </Button>
          <Button size="small" variant="primary" icon={<UploadIcon width={15} height={15} />} onClick={() => onAction('upload')}>
            Upload
          </Button>
        </div>
      </div>

      {totalItems > 0 ? (
        <div className="gallery__grid">
          {data.folders.map(folder => {
            const folderPath = currentPath === '/' ? `/${folder}` : `${currentPath}/${folder}`;
            return (
              <FolderCard
                key={folder}
                name={folder}
                onClick={() => onNavigate(folderPath)}
                onContextMenu={e => handleContextMenu(e, { name: folder, type: 'folder' }, 'folder')}
              />
            );
          })}
          {data.files.map(file => (
            <FileCard
              key={file.name}
              file={file}
              onClick={() => onOpenFile(file)}
              onContextMenu={e => handleContextMenu(e, file, 'file')}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderIcon width={36} height={36} />}
          title="Nothing here yet"
          subtitle="Upload HTML files or create a folder to get started"
          action={<Button variant="primary" icon={<UploadIcon width={15} height={15} />} onClick={() => onAction('upload')}>Upload files</Button>}
        />
      )}

      <DropZone onDrop={() => onAction('upload')} />

      {contextMenu && <ContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />}
    </div>
  );
}

Object.assign(window, { GalleryView });
