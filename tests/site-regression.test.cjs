'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

test('root index.html remains the only HTML entry; direct site address keeps working', () => {
  const htmlFiles = fs.readdirSync(ROOT).filter(name => /\.html?$/i.test(name));
  assert.deepEqual(htmlFiles, ['index.html']);
  assert.match(html, /<title>Chordinary v38 · Harmony Training Lab<\/title>/);
  assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
});

test('backup compatibility: version changes without renaming the persistent storage key', () => {
  assert.match(html, /const STORE_KEY='chordinary_state'/);
  assert.match(html, /chordinary_v35_state/);
  assert.match(html, /function backupPayload\(\)\{return \{app:'Chordinary',version:'v38'/);
  assert.match(html, /Chordinary_v38_backup_/);
});

test('both inline scripts and worker parse without executing user data', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 2);
  scripts.forEach((match, index) => assert.doesNotThrow(
    () => new vm.Script(match[1], {filename: 'index-inline-' + index + '.js'})
  ));
  assert.doesNotThrow(() => new vm.Script(worker, {filename: 'sw.js'}));
});

function createWorker({network, offlineCache} = {}) {
  const handlers = {};
  const cacheWrites = [];
  const deleted = [];
  const cache = {
    add: async () => {},
    put: async (request, response) => { cacheWrites.push({request, response}); },
  };
  const storage = {
    open: async () => cache,
    match: async key => offlineCache ? offlineCache(key) : null,
    keys: async () => ['chordinary-offline', 'chordinary-offline-v38', 'unrelated-site'],
    delete: async name => { deleted.push(name); return true; },
  };
  const self = {
    location: {href: 'https://example.com/JAZ/sw.js'},
    skipWaiting() {},
    clients: {claim: async () => true},
    addEventListener(name, callback) { handlers[name] = callback; },
  };
  vm.runInNewContext(worker, {
    self, caches: storage, URL, Response, Promise,
    fetch: network || (async () => { throw new Error('offline'); }),
  }, {filename: 'sw.js'});
  async function dispatch(type, request = undefined) {
    let delivered;
    const background = [];
    const event = {
      request,
      respondWith(promise) { delivered = promise; },
      waitUntil(promise) { background.push(promise); },
    };
    handlers[type](event);
    const response = delivered === undefined ? undefined : await delivered;
    await Promise.all(background);
    return response;
  }
  return {dispatch, cacheWrites, deleted};
}

test('online requests are network-first and refresh cached files', async () => {
  const expected = new Response('current index', {status: 200});
  const app = createWorker({network: async () => expected});
  const response = await app.dispatch('fetch', {
    url: 'https://example.com/JAZ/',
    method: 'GET',
    mode: 'navigate',
  });
  assert.equal(await response.text(), 'current index');
  assert.equal(app.cacheWrites.length, 1);
});

test('an offline page navigation can fall back to the cached index', async () => {
  const cached = new Response('cached index.html', {headers: {'content-type': 'text/html'}});
  const app = createWorker({offlineCache: async key => (
    key === 'https://example.com/JAZ/index.html' ? cached : null
  )});
  const response = await app.dispatch('fetch', {
    url: 'https://example.com/JAZ/?tab=ear',
    method: 'GET', mode: 'navigate',
  });
  assert.equal(await response.text(), 'cached index.html');
});

test('missing image offline cannot be incorrectly replaced by HTML', async () => {
  const app = createWorker({offlineCache: async key => (
    key === 'https://example.com/JAZ/index.html' ? new Response('<html></html>') : null
  )});
  const response = await app.dispatch('fetch', {
    url: 'https://example.com/JAZ/missing-image.png',
    method: 'GET', mode: 'no-cors',
  });
  assert.equal(response.type, 'error');
});

test('requests outside site folder are not intercepted', async () => {
  const app = createWorker();
  assert.equal(await app.dispatch('fetch', {
    url: 'https://example.com/another-repository/',
    method: 'GET', mode: 'navigate',
  }), undefined);
  assert.equal(await app.dispatch('fetch', {
    url: 'https://another.example/JAZ/',
    method: 'GET', mode: 'navigate',
  }), undefined);
});

test('activation removes only obsolete Chordinary cache versions', async () => {
  const app = createWorker();
  await app.dispatch('activate');
  assert.deepEqual(app.deleted, ['chordinary-offline']);
});
