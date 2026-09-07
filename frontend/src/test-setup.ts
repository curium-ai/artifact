import { vi } from 'vitest';
if (typeof HTMLElement !== "undefined") HTMLElement.prototype.scrollIntoView = vi.fn();

if (typeof window !== 'undefined') window.matchMedia = () => ({ matches: false }) as MediaQueryList;
