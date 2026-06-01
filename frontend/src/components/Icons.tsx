import type { SVGProps } from 'react';

const I: SVGProps<SVGSVGElement> = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

export function FolderIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>;
}
export function FolderOpenIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h4"></path></svg>;
}
export function FileHtmlIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13l2 2-2 2"></path><line x1="13" y1="17" x2="16" y2="17"></line></svg>;
}
export function UploadIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>;
}
export function PlusIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
}
export function ArrowLeftIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>;
}
export function LinkIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>;
}
export function ExternalLinkIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>;
}
export function TrashIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>;
}
export function EditIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>;
}
export function MoreIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>;
}
export function LockIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>;
}
export function UnlockIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>;
}
export function ChevronRightIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><polyline points="9 18 15 12 9 6"></polyline></svg>;
}
export function ChevronDownIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><polyline points="6 9 12 15 18 9"></polyline></svg>;
}
export function XIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
}
export function HomeIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>;
}
export function CopyIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>;
}
export function SettingsIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
}
export function MoveIcon(p: SVGProps<SVGSVGElement>) {
  return <svg {...I} {...p}><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>;
}
