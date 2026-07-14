import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUetRequest,
  parseUetUserData,
  summarizeUetIdentifiers,
  parseUetConsent,
} from '../lib/uet.js';

// Real UET hits captured on atomkraftwerke24.de (Markus' playground).
const PAGELOAD = 'https://bat.bing.com/action/0?ti=111111111111&tm=gtm002&Ver=2&mid=efaaf29c-46db-49ce-9945-7bfc2a75fb45&bo=3&sid=a9eca46073d311f1b24adb4113962152&vid=eb4791d0cd0d11efbf3d29deb84731de&vids=0&msclkid=N&pid=em%3D8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa%26ph%3D2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08&uach=pv%3D19.0.0&pi=918639831&lg=de-DE&sw=1920&sh=1080&sc=32&tl=Enhanced%20Conversions%20Testseite&p=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html%3Fgtm_debug%3D1782752362088&r=https%3A%2F%2Ftagassistant.google.com%2F&lt=1323&evt=pageLoad&sv=2&asc=G&cdb=AQAS&rn=967217';
const CUSTOM = 'https://bat.bing.com/action/0?ti=111111111111&tm=gtm002&Ver=2&mid=efaaf29c-46db-49ce-9945-7bfc2a75fb45&bo=5&sid=a9eca46073d311f1b24adb4113962152&vid=eb4791d0cd0d11efbf3d29deb84731de&vids=0&msclkid=N&ec=sales&el=leadform&ev=12&gc=USD&gv=22&tpp=1&ea=conversions&pid=em%3D8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa%26ph%3D2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08&en=Y&p=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&sw=1920&sh=1080&sc=32&evt=custom&asc=G&cdb=AQAS&rn=993584';
const ECOMM = 'https://bat.bing.com/action/0?ti=111111111111&tm=gtm002&Ver=2&mid=efaaf29c-46db-49ce-9945-7bfc2a75fb45&bo=6&sid=a9eca46073d311f1b24adb4113962152&vid=eb4791d0cd0d11efbf3d29deb84731de&vids=0&msclkid=N&prodid=42&pagetype=purchase&ecomm_totalvalue=44&ecomm_category=45&tpp=1&ea=purchase&pid=em%3D8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa%26ph%3D2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08&gv=44&en=Y&p=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&sw=1920&sh=1080&sc=32&evt=custom&asc=G&cdb=AQAS&rn=957294';

test('UET pageLoad with enhanced-conversion user data', () => {
  const r = parseUetRequest(PAGELOAD, null);
  assert.ok(r);
  assert.equal(r.provider, 'uet');
  assert.equal(r.transport, 'standard');
  assert.equal(r.ti, '111111111111');
  assert.equal(r.evt, 'pageLoad');
  assert.equal(r.eventName, 'pageLoad');
  assert.ok(r.userData);
  assert.equal(r.userData.em.bucket, 'email');
  assert.equal(r.userData.em.hashed, true);
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 0, address: 0 });
  assert.equal(r.flags.enhancedConv, true);
  assert.equal(r.consent.adStorage, 'granted');   // asc=G
});

test('UET custom conversion: category – action name, value and revenue', () => {
  const r = parseUetRequest(CUSTOM, null);
  assert.ok(r);
  assert.equal(r.evt, 'custom');
  assert.equal(r.eventName, 'sales – conversions');   // ec – ea
  assert.equal(r.ec, 'sales');
  assert.equal(r.el, 'leadform');
  assert.equal(r.ev, '12');
  assert.deepEqual(r.revenue, { value: '22', currency: 'USD' });
  assert.equal(r.flags.custom, true);
  assert.equal(r.flags.revenue, true);
});

test('a named evt (pageHide) is the event name, not "custom event"', () => {
  const r = parseUetRequest('https://bat.bing.com/actionp/0?ti=111111111111&tm=gtm002&Ver=2&mid=d1010077-57cc-4186-83c6-c3a97845dfb6&bo=5&sid=6db87fb07ea211f19b05c353b94c66ca&vid=eb4791d0cd0d11efbf3d29deb84731de&vids=0&msclkid=N&evt=pageHide&asc=G', null);
  assert.ok(r);
  assert.equal(r.evt, 'pageHide');
  assert.equal(r.eventName, 'pageHide');   // evt itself names it — no ec/ea present
});

test('an empty gv= is no revenue, not a zero-value one', () => {
  const r = parseUetRequest('https://bat.bing.com/action/0?ti=111111111111&evt=custom&ec=cat&ea=act&gv=&gc=EUR', null);
  assert.ok(r);
  assert.equal(r.revenue, null);
  assert.equal(r.flags.revenue, false);
});

test('UET consent signal (evt=consent) is distinct, not a custom event', () => {
  const update = parseUetRequest('https://bat.bing.com/actionp/0?ti=111111111111&tm=gtm002&Ver=2&mid=a370fb0a&bo=1&evt=consent&src=update&cdb=AQAS&asc=G', null);
  assert.ok(update);
  assert.equal(update.evt, 'consent');
  assert.equal(update.src, 'update');
  assert.equal(update.eventName, 'consent update');
  assert.equal(update.flags.consentEvent, true);
  assert.equal(update.flags.custom, false);          // not misreported as a tracking event
  assert.equal(update.consent.adStorage, 'granted');

  const def = parseUetRequest('https://bat.bing.com/actionp/0?ti=1&evt=consent&src=default&asc=D', null);
  assert.equal(def.eventName, 'consent default');
  assert.equal(def.consent.adStorage, 'denied');
});

test('UET evt=pid is "personal data", not a custom event', () => {
  const r = parseUetRequest('https://bat.bing.com/actionp/0?ti=1&evt=pid&pid=em%3D8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa', null);
  assert.ok(r);
  assert.equal(r.eventName, 'personal data');
  assert.equal(r.flags.personalData, true);
  assert.equal(r.flags.custom, false);
  assert.equal(r.identifiers.email, 1);    // pid user data still parsed
});

test('UET CST/Flex endpoint (commerce.bing.com/cst) is detected', () => {
  const r = parseUetRequest('https://commerce.bing.com/cst/0?ti=111111111111&evt=custom&ec=cat&ea=act', null);
  assert.ok(r);
  assert.equal(r.transport, 'standard');
  assert.equal(r.eventName, 'cat – act');
});

test('UET hit without evt is a beacon; ecomm aliases + currency fallback', () => {
  const beacon = parseUetRequest('https://bat.bing.com/action/0?ti=1', null);
  assert.equal(beacon.eventName, 'beacon');
  assert.equal(beacon.flags.beacon, true);
  assert.equal(beacon.flags.custom, false);

  const alias = parseUetRequest('https://bat.bing.com/action/0?ti=1&evt=custom&ecomm_prodid=99&ecomm_pagetype=purchase&ecomm_totalvalue=5&currency=EUR', null);
  assert.equal(alias.ecommerce.prodid, '99');        // read from ecomm_prodid alias
  assert.equal(alias.ecommerce.pagetype, 'purchase');
  assert.deepEqual(alias.revenue, { value: '5', currency: 'EUR' });  // currency fallback (no gc)
});

test('UET e-commerce event: ecommerce fields and revenue from gv', () => {
  const r = parseUetRequest(ECOMM, null);
  assert.ok(r);
  assert.equal(r.eventName, 'purchase');           // ea
  assert.ok(r.ecommerce);
  assert.equal(r.ecommerce.prodid, '42');
  assert.equal(r.ecommerce.pagetype, 'purchase');
  assert.equal(r.ecommerce.ecomm_totalvalue, '44');
  assert.equal(r.flags.ecommerce, true);
  assert.deepEqual(r.revenue, { value: '44', currency: null });
});

test('consent: asc=G granted, asc=D denied, absent = unset (visible)', () => {
  assert.equal(parseUetConsent((k) => (k === 'asc' ? 'G' : null)).adStorage, 'granted');
  assert.equal(parseUetConsent((k) => (k === 'asc' ? 'D' : null)).adStorage, 'denied');
  const absent = parseUetConsent(() => null);
  assert.equal(absent.adStorage, 'unset');         // asc missing → reported, not dropped
  assert.equal(absent.asc, null);
});

test('first-party proxied /action on the page’s own domain (same-site)', () => {
  const r = parseUetRequest('https://track.example.com/action/0?ti=999&evt=pageLoad', null, 'https://www.example.com/');
  assert.ok(r);
  assert.equal(r.transport, 'first-party');
});

test('proxied /action on a foreign domain stays visible but is unknown', () => {
  const r = parseUetRequest('https://track.taggrs.io/action/0?ti=999&evt=pageLoad', null, 'https://example.com/');
  assert.ok(r);                                  // hit is NOT dropped
  assert.equal(r.transport, 'unknown');
});

test('proxied /action without a page URL cannot claim first-party', () => {
  const r = parseUetRequest('https://track.example.com/action/0?ti=999&evt=pageLoad', null);
  assert.ok(r);
  assert.equal(r.transport, 'unknown');
});

test('non-UET requests are ignored', () => {
  assert.equal(parseUetRequest('https://bat.bing.com/action/0?evt=pageLoad', null), null); // no ti
  assert.equal(parseUetRequest('https://www.bing.com/search?q=x', null), null);
  assert.equal(parseUetRequest('https://example.com/app.js', null), null);
});

test('parseUetUserData / summarize standalone', () => {
  const ud = parseUetUserData('em=abc&ph=def&fn=x');
  assert.equal(Object.keys(ud).length, 3);
  assert.deepEqual(summarizeUetIdentifiers(ud), { email: 1, phone: 1, name: 1, address: 0 });
  assert.equal(parseUetUserData(''), null);
  assert.equal(parseUetUserData('foo=bar'), null);   // no known identifier keys
});
