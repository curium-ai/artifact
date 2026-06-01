// ui.jsx — PostHog-inspired icons + UI primitives for Artifact
const { useState, useRef, useEffect, useCallback, createContext, useContext, forwardRef } = React;

// ═══════════════════════════════════════
// ICONS (Lucide-style stroke icons)
// ═══════════════════════════════════════
const I = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

function FolderIcon(p) {
  return <svg {...I} {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>;
}
function FolderOpenIcon(p) {
  return <svg {...I} {...p}><path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h4"></path></svg>;
}
function FileHtmlIcon(p) {
  return <svg {...I} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13l2 2-2 2"></path><line x1="13" y1="17" x2="16" y2="17"></line></svg>;
}
function UploadIcon(p) {
  return <svg {...I} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>;
}
function PlusIcon(p) {
  return <svg {...I} {...p}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
}
function ArrowLeftIcon(p) {
  return <svg {...I} {...p}><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>;
}
function LinkIcon(p) {
  return <svg {...I} {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>;
}
function ExternalLinkIcon(p) {
  return <svg {...I} {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>;
}
function TrashIcon(p) {
  return <svg {...I} {...p}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
}
function EditIcon(p) {
  return <svg {...I} {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>;
}
function MoreIcon(p) {
  return <svg {...I} {...p}><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>;
}
function LockIcon(p) {
  return <svg {...I} {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>;
}
function UnlockIcon(p) {
  return <svg {...I} {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>;
}
function SearchIcon(p) {
  return <svg {...I} {...p}><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;
}
function ChevronRightIcon(p) {
  return <svg {...I} {...p}><polyline points="9 18 15 12 9 6"></polyline></svg>;
}
function ChevronDownIcon(p) {
  return <svg {...I} {...p}><polyline points="6 9 12 15 18 9"></polyline></svg>;
}
function XIcon(p) {
  return <svg {...I} {...p}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
}
function CheckIcon(p) {
  return <svg {...I} {...p}><polyline points="20 6 9 17 4 12"></polyline></svg>;
}
function GridIcon(p) {
  return <svg {...I} {...p}><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>;
}
function ListIcon(p) {
  return <svg {...I} {...p}><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>;
}
function HomeIcon(p) {
  return <svg {...I} {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
}
function CopyIcon(p) {
  return <svg {...I} {...p}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
}
function LayoutIcon(p) {
  return <svg {...I} {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>;
}
function SettingsIcon(p) {
  return <svg {...I} {...p}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
}

// ═══════════════════════════════════════
// BUTTON
// ═══════════════════════════════════════
function Button({ children, variant = 'secondary', size = 'medium', icon, iconRight, onClick, disabled, className = '', style, title }) {
  const sizeClass = `btn--${size}`;
  const variantClass = `btn--${variant}`;
  return (
    <button
      className={`btn ${variantClass} ${sizeClass} ${className}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      title={title}
      aria-disabled={disabled}
    >
      {icon && <span className="btn__icon">{icon}</span>}
      {children && <span className="btn__content">{children}</span>}
      {iconRight && <span className="btn__icon">{iconRight}</span>}
    </button>
  );
}

// ═══════════════════════════════════════
// INPUT
// ═══════════════════════════════════════
function Input({ value, onChange, placeholder, type = 'text', icon, autoFocus, onKeyDown, className = '', style }) {
  return (
    <div className={`input-wrap ${className}`} style={style}>
      {icon && <span className="input-wrap__icon">{icon}</span>}
      <input
        className="input-wrap__input"
        type={type}
        value={value}
        onChange={e => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

// ═══════════════════════════════════════
// MODAL
// ═══════════════════════════════════════
function Modal({ title, children, onClose, width = 400 }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
          <button className="modal__close" onClick={onClose}><XIcon width={16} height={16} /></button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// TOAST
// ═══════════════════════════════════════
const ToastContext = createContext(null);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, duration = 2500) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast() {
  return useContext(ToastContext);
}

// ═══════════════════════════════════════
// BREADCRUMB
// ═══════════════════════════════════════
function Breadcrumb({ path, onNavigate }) {
  const parts = path === '/' ? [''] : path.split('/');
  return (
    <nav className="breadcrumb">
      {parts.map((part, i) => {
        const target = i === 0 ? '/' : '/' + parts.slice(1, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRightIcon width={14} height={14} className="breadcrumb__sep" />}
            <button
              className={`breadcrumb__item ${isLast ? 'breadcrumb__item--active' : ''}`}
              onClick={() => onNavigate(target)}
            >
              {i === 0 ? <HomeIcon width={15} height={15} /> : part}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener('click', handler);
    window.addEventListener('contextmenu', handler);
    return () => { window.removeEventListener('click', handler); window.removeEventListener('contextmenu', handler); };
  }, [onClose]);

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item.divider ? <div key={i} className="context-menu__divider"></div> :
        <button key={i} className={`context-menu__item ${item.danger ? 'context-menu__item--danger' : ''}`} onClick={() => { item.action(); onClose(); }}>
          {item.icon && <span className="context-menu__icon">{item.icon}</span>}
          {item.label}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════
function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <p className="empty-state__title">{title}</p>
      {subtitle && <p className="empty-state__sub">{subtitle}</p>}
      {action}
    </div>
  );
}

// ═══════════════════════════════════════
// FILE PREVIEW COLOR (deterministic from name)
// ═══════════════════════════════════════
function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PREVIEW_COLORS = [
  ['#1D4AFF', '#4C6FFF'], ['#F54E00', '#FF7E3D'], ['#388600', '#5CB026'],
  ['#8F3FCE', '#B06AE8'], ['#F7A501', '#FFBE3D'], ['#E0457B', '#F06A9A'],
  ['#0EA5E9', '#38BDF8'], ['#6366F1', '#818CF8'], ['#14B8A6', '#2DD4BF'],
];

function getPreviewGradient(name) {
  const idx = hashStr(name) % PREVIEW_COLORS.length;
  const [a, b] = PREVIEW_COLORS[idx];
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

// Export all to window
Object.assign(window, {
  FolderIcon, FolderOpenIcon, FileHtmlIcon, UploadIcon, PlusIcon, ArrowLeftIcon,
  LinkIcon, ExternalLinkIcon, TrashIcon, EditIcon, MoreIcon, LockIcon, UnlockIcon,
  SearchIcon, ChevronRightIcon, ChevronDownIcon, XIcon, CheckIcon, GridIcon,
  ListIcon, HomeIcon, CopyIcon, LayoutIcon, SettingsIcon,
  Button, Input, Modal, ToastProvider, ToastContext, useToast,
  Breadcrumb, ContextMenu, EmptyState,
  hashStr, getPreviewGradient,
});
