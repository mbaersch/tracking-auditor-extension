import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStapeTunnel } from '../lib/stape.js';
import { parseGoogleAdsRequest } from '../lib/googleads.js';
import { parseFloodlightRequest } from '../lib/floodlight.js';

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const tunnel = (path) => `https://stp.shop.example/abcdef/239?0355ae1a=${encodeURIComponent(b64(path))}`;

test('decodes a tunneled path onto the tunnel host', () => {
  const d = decodeStapeTunnel(tunnel('/data?v=2&event=page_view'));
  assert.ok(d);
  assert.equal(d.url, 'https://stp.shop.example/data?v=2&event=page_view');
  assert.equal(d.host, 'stp.shop.example');
  assert.equal(d.encodedParam, '0355ae1a');
});

test('script loads and non-path values are not tunnels', () => {
  assert.equal(decodeStapeTunnel(tunnel('/gtag/js?id=G-TEST123')), null);
  assert.equal(decodeStapeTunnel(tunnel('/gtm.js?id=GTM-TEST')), null);
  assert.equal(decodeStapeTunnel(tunnel('/abc/loader.js?v=1')), null);
  assert.equal(decodeStapeTunnel('https://stp.shop.example/x?q=' + b64('just some text here')), null);
  assert.equal(decodeStapeTunnel('https://stp.shop.example/x?short=abc'), null);
});

test('Floodlight path is rebuilt on its vendor host so the parser claims it', () => {
  const d = decodeStapeTunnel(tunnel('/activity;src=1234567;type=sales;cat=purch0;ord=A1;cost=9.90'));
  assert.equal(new URL(d.url).host, 'ad.doubleclick.net');
  assert.ok(parseFloodlightRequest(d.url), 'decoded Floodlight hit should parse');
});

test('Google Ads conversion path stays on the tunnel host and still parses', () => {
  const d = decodeStapeTunnel(tunnel('/pagead/conversion/123456789/?label=abcDEF&value=9.9&currency_code=EUR'));
  assert.equal(new URL(d.url).host, 'stp.shop.example');
  const r = parseGoogleAdsRequest(d.url, null, 'https://www.shop.example/');
  assert.ok(r, 'path-based Ads parser should claim the decoded hit');
  assert.equal(r.transport, 'first-party');
});
