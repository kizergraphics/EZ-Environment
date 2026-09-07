const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveAssetPath, isAllowedRequest, parseDevOrigin, CONTENT_SECURITY_POLICY } = require('./security.cjs');

test('the app protocol serves only files within its bundle', () => {
  const root = path.resolve('dist');
  assert.equal(resolveAssetPath('ez-environment://app/', root), path.join(root, 'index.html'));
  assert.equal(resolveAssetPath('ez-environment://app/assets/a%20b.js?x=1', root), path.join(root, 'assets/a b.js'));
  for (const url of ['file:///C:/Windows/win.ini', 'https://app/index.html', 'ez-environment://other/index.html', 'ez-environment://user@app/index.html', 'ez-environment://app/%2e%2e%2fpackage.json', 'ez-environment://app/%5cWindows%5cwin.ini', 'ez-environment://app/C:%5cWindows', 'ez-environment://app/%00bad', 'ez-environment://app/%invalid']) {
    assert.equal(resolveAssetPath(url, root), null, url);
  }
});

test('packaged requests never access network or arbitrary local files', () => {
  for (const url of ['ez-environment://app/', 'ez-environment://app/assets/main.js', 'data:image/png;base64,AA', 'blob:ez-environment://app/1234']) assert.equal(isAllowedRequest(url), true, url);
  for (const url of ['https://example.com', 'http://127.0.0.1:5173', 'file:///C:/Windows/win.ini', 'ws://127.0.0.1', 'ez-environment://app.evil/', 'blob:https://example.com/id']) assert.equal(isAllowedRequest(url), false, url);
});

test('development accepts only its exact loopback origin and websocket', () => {
  const origin = parseDevOrigin('http://127.0.0.1:5173', false);
  assert.equal(isAllowedRequest(origin + '/src/main.js', origin), true);
  assert.equal(isAllowedRequest('ws://127.0.0.1:5173', origin), true);
  assert.equal(isAllowedRequest('http://127.0.0.1:5174', origin), false);
  assert.equal(parseDevOrigin(origin, true), null);
  assert.throws(() => parseDevOrigin('https://example.com', false));
});

test('CSP permits local rendering and Draco without script or frame escape', () => {
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-src 'none'/);
  assert.ok(!CONTENT_SECURITY_POLICY.includes('https:'));
});

test('portable packaging keeps library entry points and cannot publish', () => {
  const config = require('../electron-builder.config.cjs');
  const pkg = require('../package.json');
  assert.equal(pkg.main, 'build/ez-tree.umd.js');
  assert.equal(pkg.exports['.'].import, './build/ez-tree.es.js');
  assert.equal(config.extraMetadata.main, 'desktop/main.cjs');
  assert.deepEqual(config.win.target, [{ target: 'portable', arch: ['x64'] }]);
  assert.equal(config.publish, null);
  assert.equal(config.win.requestedExecutionLevel, 'asInvoker');
  assert.ok(config.files.includes('dist/**/*'));
  assert.ok(!config.files.includes('**/*'));
});
