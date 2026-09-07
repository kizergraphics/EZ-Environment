const path = require('node:path');

const APP_ORIGIN = 'ez-environment://app';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function resolveAssetPath(requestUrl, root) {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'ez-environment:' || url.host !== 'app' || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if (/[\\\u0000:]/.test(pathname)) return null;
    const target = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return target;
  } catch { return null; }
}

function isAllowedRequest(requestUrl, devOrigin = null) {
  try {
    const url = new URL(requestUrl);
    if (url.username || url.password) return false;
    if (url.protocol === 'ez-environment:') return url.host === 'app';
    if (url.protocol === 'blob:') return url.pathname.startsWith(APP_ORIGIN + '/') || Boolean(devOrigin && url.pathname.startsWith(devOrigin + '/'));
    if (url.protocol === 'data:') return true;
    if (devOrigin && url.origin === devOrigin) return true;
    if (devOrigin && url.protocol === 'ws:') return 'http://' + url.host === devOrigin;
    return false;
  } catch { return false; }
}

function parseDevOrigin(value, isPackaged) {
  if (!value || isPackaged) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) {
    throw new Error('Desktop development server must use http://127.0.0.1.');
  }
  return url.origin;
}

module.exports = { APP_ORIGIN, CONTENT_SECURITY_POLICY, resolveAssetPath, isAllowedRequest, parseDevOrigin };
