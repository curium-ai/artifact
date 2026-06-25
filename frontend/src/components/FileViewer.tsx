import { useEffect, useState } from 'react';
import { ArrowLeftIcon, FileHtmlIcon, CopyIcon, ExternalLinkIcon, LinkIcon } from './Icons';
import { Button, useToast } from './ui';
import { publicHref } from '../utils';

interface FileViewerProps {
  fileName: string;
  path: string;
  onBack: () => void;
}

export function FileViewer({ fileName, path, onBack }: FileViewerProps) {
  const toast = useToast();
  const publicPath = publicHref(path, fileName);
  const publicUrl = window.location.origin + publicPath;
  const [missing, setMissing] = useState(false);

  // An iframe stays blank on a 404 rather than surfacing the error, so probe
  // the source directly and show a recoverable "not found" state instead.
  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    fetch(publicPath)
      .then(res => { if (!cancelled && res.status === 404) setMissing(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [publicPath]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(publicUrl).catch(() => {});
    toast('Link copied to clipboard');
  };

  const handleOpenTab = () => {
    window.open(publicPath, '_blank');
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
          <span>{fileName}</span>
        </div>
        <div className="viewer__actions">
          <Button size="small" icon={<CopyIcon width={15} height={15} />} onClick={handleCopyLink}>
            Copy link
          </Button>
          <Button size="small" icon={<ExternalLinkIcon width={15} height={15} />} onClick={handleOpenTab}>
            Open
          </Button>
        </div>
      </div>
      <div className="viewer__frame">
        {missing ? (
          <div className="viewer__missing">
            <FileHtmlIcon width={36} height={36} />
            <p className="viewer__missing-title">File not found</p>
            <p className="viewer__missing-sub">"{fileName}" may have been moved, renamed, or deleted.</p>
            <Button size="small" onClick={onBack}>Back to folder</Button>
          </div>
        ) : (
          <iframe
            src={publicPath}
            sandbox="allow-scripts allow-same-origin"
            title={fileName}
          />
        )}
      </div>
      <div className="viewer__url-bar">
        <LinkIcon width={14} height={14} />
        <span className="viewer__url">{publicUrl}</span>
      </div>
    </div>
  );
}
