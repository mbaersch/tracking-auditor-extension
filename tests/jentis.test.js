import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJentisRequest, jentisBody, commandOf, readVendorConsent } from '../lib/jentis.js';

// Shapes of real JENTIS requests (three live sites, 11/2026), anonymised: random
// subdomain → abc123.example.com, account → example-com.live, ids shortened.
const URL_ = 'https://abc123.example.com/';
const USER = { _id: 'u1', action: 'upd', account: 'example-com.live', documentType: 'user', property: {}, system: {}, aggr: {}, parent: {} };
const SESSION = { _id: 's1', action: 'upd', account: 'example-com.live', documentType: 'session', property: { jts_version: '_' }, system: { 'navigator-userAgent': 'x' }, parent: { user: 'u1' } };
const body = (data, extra = {}) => JSON.stringify({ client: { clientTimestamp: 1794928209135, domain: '.example.com' }, cmd: {}, data, requestType: 'XMLHttpRequest', ...extra });

const PAGEVIEW_PRE = {
  _id: 'e1', documentType: 'event', action: 'new', account: 'example-com.live', pluginid: 'jts_push_submit',
  parent: { user: 'u1', session: 's1' },
  system: { href: 'https://www.example.com/', consent: { jentis_predictor_collector: true } },
  property: { jtspushedcommands: ['pageview', 'submit'], window_location_href: 'https://www.example.com/', document_title: 'Start', event_name: '', search_param_utm_source: '' },
};
// Same _id after the consent decision: full vendor list, more fields.
const PAGEVIEW_POST = {
  ...PAGEVIEW_PRE,
  system: { href: 'https://www.example.com/', consent: { jentis_predictor_collector: true, google_analytics_4_server_side: false, adwords: 'ncm', facebook: 'ncm', mouseflow: false } },
  property: { ...PAGEVIEW_PRE.property, load_time: 674, href_pathname: '/' },
};
const LEAD = {
  _id: 'e2', documentType: 'event', action: 'new', account: 'example-com.live', pluginid: 'jts_push_submit',
  system: { href: 'https://www.example.com/contact/', consent: { adwords: true, facebook: true } },
  property: { jtspushedcommands: ['event'], event_name: 'lead_submit', event_group: 'Form', event_value: 'X1', window_location_href: 'https://www.example.com/contact/' },
};
// A product/order push to a container without e-commerce variables: only the commands arrive.
const ORDER = {
  _id: 'e3', documentType: 'event', action: 'new', account: 'example-com.stage', pluginid: 'jts_push_submit',
  system: { href: 'https://www.example.com/de', consent: { GA4: true } },
  property: { jtspushedcommands: ['product', 'order', 'submit'], window_location_href: 'https://www.example.com/de', href_pathname: '/de', event_name: '', checkout_step: '' },
};
const SCROLL = {
  _id: 'e4', documentType: 'event', action: 'new', account: 'example-com.live', pluginid: 'scroll_tracking',
  system: { href: 'https://www.example.com/', consent: { adwords: true } },
  property: { scroll_depth_value: 10, window_location_href: 'https://www.example.com/' },
};
const CONSENT = {
  _id: 'c1', documentType: 'consent', action: 'new', account: 'example-com.live', parent: { user: 'u1' },
  property: {
    track: 'consent', consentid: '5502529c', lastupdate: 1794928210405, send: true, userconsent: true,
    vendors: { jentis_predictor_collector: true, adwords: 'ncm', mouseflow: false, cstm_x: false },
    vendorsConsentMode: { adwords: 2, mouseflow: 0 }, vendorsChanged: { adwords: true },
  },
};

test('detection is by body signature, URL and transport are irrelevant', () => {
  assert.ok(jentisBody(body([USER, PAGEVIEW_PRE])));
  assert.ok(jentisBody({ text: body([USER, PAGEVIEW_PRE]) }));                        // HAR {text}
  assert.ok(parseJentisRequest('https://www.example.com/abc123', body([USER, LEAD])));  // main-domain path
  assert.equal(jentisBody(null), null);
  assert.equal(jentisBody('en=page_view&v=2'), null);
  assert.equal(jentisBody(JSON.stringify({ data: [{ documentType: 'event' }] })), null);  // no client envelope
  assert.equal(jentisBody(JSON.stringify({ client: {}, data: [{ type: 'x' }] })), null);   // no documentType
  assert.equal(jentisBody('{"events":[{"type":"page_viewed"}]}'), null);
});

test('user/session documents and cookie-only requests produce no card', () => {
  assert.equal(parseJentisRequest(URL_, body([USER, SESSION])), null);
  const cookieOnly = JSON.stringify({ client: {}, cmd: { key: 'setcookie-itp-proxy', data: [] }, data: [], requestType: 'XMLHttpRequest' });
  assert.equal(parseJentisRequest('https://www.example.com/abc123', cookieOnly), null);
});

test('one record per event/consent document, named by command, event_name or pluginid', () => {
  const recs = parseJentisRequest(URL_, body([USER, SESSION, PAGEVIEW_PRE, LEAD, ORDER, SCROLL, CONSENT]));
  assert.deepEqual(recs.map((r) => [r.event, r.eventType]), [
    ['pageview', 'command'], ['lead_submit', 'event'], ['order', 'command'],
    ['scroll', 'plugin'], ['consent', 'consent'],
  ]);
  const [pv, lead, order, scroll, consent] = recs;
  assert.equal(pv.account, 'example-com.live');
  assert.equal(pv.pageUrl, 'https://www.example.com/');
  assert.equal(pv.flags.standardCommand, true);
  assert.equal(lead.eventGroup, 'Form');
  assert.equal(lead.eventValue, 'X1');
  assert.equal(lead.flags.custom, true);
  assert.deepEqual(order.pushedCommands, ['product', 'order', 'submit']);
  assert.equal(order.flags.ecommerce, true);
  assert.equal(scroll.pluginId, 'scroll_tracking');
  assert.equal(consent.consent.source, 'consent document (property.vendors)');
  assert.deepEqual(consent.consentModes, { adwords: 2, mouseflow: 0 });
});

test('container fields are kept verbatim, empty ones and those shown elsewhere are dropped', () => {
  const [pv] = parseJentisRequest(URL_, body([PAGEVIEW_PRE]));
  assert.deepEqual(pv.properties, { window_location_href: 'https://www.example.com/', document_title: 'Start' });
  const [order] = parseJentisRequest(URL_, body([ORDER]));
  assert.deepEqual(order.properties, { window_location_href: 'https://www.example.com/de', href_pathname: '/de' });
});

test('per-vendor consent: granted / denied / ncm are counted, ncm shown verbatim', () => {
  const [pv] = parseJentisRequest(URL_, body([PAGEVIEW_POST]));
  assert.deepEqual(pv.consent.counts, { granted: 1, denied: 2, ncm: 2, other: 0 });
  assert.equal(pv.consent.vendors.adwords, 'ncm');
  assert.equal(pv.consent.source, 'system.consent');
  assert.deepEqual(readVendorConsent({ a: 'maybe' }).counts, { granted: 0, denied: 0, ncm: 0, other: 1 });
  assert.equal(readVendorConsent(undefined), null);
});

test('the resend after consent shares the collapse key and ranks higher', () => {
  const [pre] = parseJentisRequest(URL_, body([PAGEVIEW_PRE]));
  // the resend keeps the first copy's clientTimestamp (seen live)
  const [post] = parseJentisRequest(URL_, body([PAGEVIEW_POST]));
  assert.equal(pre._collapseKey, 'jentis:event:e1');
  assert.equal(post._collapseKey, pre._collapseKey);
  assert.ok(post._transportRank > pre._transportRank);
  assert.notEqual(post._transportLabel, pre._transportLabel);
});

test('product_* columns are zipped into items; empty slots dropped, other fields kept', () => {
  // Shape seen live: one array per field, one entry per item of a product list.
  const LIST = {
    _id: 'e5', documentType: 'event', action: 'new', account: 'example-com.live', pluginid: 'jts_push_submit',
    system: { href: 'https://www.example.com/shop/', consent: { adwords: true } },
    property: {
      jtspushedcommands: ['product', 'product', 'productlist', 'submit'],
      product_id: ['1001', '1002'], product_name: ['Socks', 'Hat'], product_price: [35, 12.5],
      product_brand: ['ACME', 'ACME'], product_category: ['', ''], product_sku: ['', null],
      product_position: [1, 2], product_type: ['productlist', 'productlist'],
      productlist_name_of_product: ['', 'Winter'],
      product_note: ['only one'],                  // other length → not a column of these items
      window_location_href: 'https://www.example.com/shop/',
    },
  };
  const [r] = parseJentisRequest(URL_, body([LIST]));
  assert.equal(r.event, 'productlist');
  assert.deepEqual(r.products, [
    { id: '1001', name: 'Socks', price: '35', brand: 'ACME', position: '1', type: 'productlist' },
    { id: '1002', name: 'Hat', price: '12.5', brand: 'ACME', position: '2', type: 'productlist', productlist_name: 'Winter' },
  ]);
  assert.equal(r.flags.itemCount, 2);
  assert.equal(r.flags.ecommerce, true);
  assert.deepEqual(r.properties, { product_note: '["only one"]', window_location_href: 'https://www.example.com/shop/' });
});

test('a single product as scalars is one item', () => {
  const VIEW = { ...ORDER, _id: 'e6', property: { jtspushedcommands: ['product', 'productview', 'submit'], product_id: '1001', product_name: 'Socks', product_price: 35 } };
  const [r] = parseJentisRequest(URL_, body([VIEW]));
  assert.deepEqual(r.products, [{ id: '1001', name: 'Socks', price: '35' }]);
});

test('commandOf skips the framing commands', () => {
  assert.equal(commandOf(['product', 'addtocart', 'submit']), 'addtocart');
  assert.equal(commandOf(['pageview', 'submit']), 'pageview');
  assert.equal(commandOf(['submit']), null);
  assert.equal(commandOf(undefined), null);
});
