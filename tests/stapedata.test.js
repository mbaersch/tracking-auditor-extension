import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStapeDataClient } from '../lib/stapedata.js';

// Shape of a real Data Tag hit (atomkraftwerke24.de, trimmed).
const URL_ = 'https://data.example.com/data?v=2&event=page_view';
const BODY = JSON.stringify({
  page_location: 'https://www.example.com/', consent_state: { ad_storage: true },
  common_cookie: { _fbp: 'fb.1.1.1' }, event_name: 'page_view', v: 2,
});

test('Data Tag POST is recognised, as string or HAR {text}', () => {
  assert.deepEqual(parseStapeDataClient(URL_, BODY), { host: 'data.example.com', path: '/data', event: 'page_view' });
  assert.deepEqual(parseStapeDataClient(URL_, { text: BODY }), { host: 'data.example.com', path: '/data', event: 'page_view' });
});

test('custom path is fine; v and a matching event_name are required', () => {
  assert.ok(parseStapeDataClient('https://s.example.com/x/collect-data?v=2&event=page_view', BODY));
  assert.equal(parseStapeDataClient('https://data.example.com/data?v=1&event=page_view', BODY), null);
  assert.equal(parseStapeDataClient('https://data.example.com/data?v=2&event=purchase', BODY), null);
  assert.equal(parseStapeDataClient(URL_, null), null);
  assert.equal(parseStapeDataClient(URL_, 'en=page_view&v=2'), null);
  assert.equal(parseStapeDataClient(URL_, '[{"event_name":"page_view"}]'), null);
});
