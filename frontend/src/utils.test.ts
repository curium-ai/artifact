import { describe, it, expect } from 'vitest';
import { folderUrl, fileUrl, parseFolderPath, parseFilePath, parseLocation } from './utils';

describe('folder/file URL helpers', () => {
  it('maps folder paths to /folder URLs (root stays /)', () => {
    expect(folderUrl('/')).toBe('/');
    expect(folderUrl('/docs')).toBe('/folder/docs');
    expect(folderUrl('/docs/2024')).toBe('/folder/docs/2024');
  });

  it('percent-encodes folder segments', () => {
    expect(folderUrl('/my docs')).toBe('/folder/my%20docs');
  });

  it('maps files to /file URLs including the name', () => {
    expect(fileUrl('/', 'a.html')).toBe('/file/a.html');
    expect(fileUrl('/docs', 'a.html')).toBe('/file/docs/a.html');
    expect(fileUrl('/my docs', 'b c.html')).toBe('/file/my%20docs/b%20c.html');
  });
});

describe('splat parsers', () => {
  it('normalizes folder splats', () => {
    expect(parseFolderPath('')).toBe('/');
    expect(parseFolderPath('docs')).toBe('/docs');
    expect(parseFolderPath('/docs/2024/')).toBe('/docs/2024');
  });

  it('splits file splats into containing folder and name', () => {
    expect(parseFilePath('a.html')).toEqual({ path: '/', name: 'a.html' });
    expect(parseFilePath('docs/2024/a.html')).toEqual({ path: '/docs/2024', name: 'a.html' });
  });
});

describe('parseLocation', () => {
  it('treats / and unknown paths as the root folder', () => {
    expect(parseLocation('/')).toEqual({ mode: 'folder', path: '/' });
    expect(parseLocation('/whatever')).toEqual({ mode: 'folder', path: '/' });
  });

  it('round-trips folder URLs (including encoded segments)', () => {
    expect(parseLocation(folderUrl('/docs/2024'))).toEqual({ mode: 'folder', path: '/docs/2024' });
    expect(parseLocation(folderUrl('/my docs'))).toEqual({ mode: 'folder', path: '/my docs' });
  });

  it('round-trips file URLs', () => {
    expect(parseLocation(fileUrl('/docs', 'a.html'))).toEqual({ mode: 'file', path: '/docs', name: 'a.html' });
    expect(parseLocation(fileUrl('/my docs', 'b c.html'))).toEqual({ mode: 'file', path: '/my docs', name: 'b c.html' });
  });
});
