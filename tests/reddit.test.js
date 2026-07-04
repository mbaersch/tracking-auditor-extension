import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRedditRequest, isRedditHost,
  extractRedditUserData, summarizeRedditIdentifiers, extractRedditConversion,
} from '../lib/reddit.js';

// Real Reddit Pixel hits captured on atomkraftwerke24.de (Markus' playground) via
// GTM: a PageVisit and a Lead. Both go to alb.reddit.com/rp.gif as GET beacons. The
// account id (a2_…) is pseudonymised; the hashes are the playground's test data
// (email hash 8d9b70fd… is the same test mail seen for LinkedIn/Snapchat).
const PAGEVISIT = 'https://alb.reddit.com/rp.gif?ts=1783195082108&id=a2_testpixel001&event=PageVisit&m.value=&m.transactionId=&m.customEventName=&m.products=&m.conversionId=a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3&uuid=0c7941b1-3509-45a8-9eb8-8a6ff0c50f65&aaid=&external_id=03c28c828cc2b2558d975399118363de6dbf96a7ac82dfa53621c524319349a1&idfa=&integration=gtm&partner=&partner_version=1.0.4&opt_out=0&sh=1920&sw=1080&v=rdt_bdf78704&dpm=&dpcc=&dprc=&em=8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa&pn=2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08&auto_em=8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa%2C8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa&auto_pn=495~2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08%7C225~01cd4d5a7001275381f4c2a3d239f5116fac598dd6d3bfee672c0b1519744e6e%7C225~120003dc53a5d1c40d3631e5cd45e762310768b34a5676260e860e06997c1df4%7C225~ebbd14c3cfad8774248530784eb7dd611cc612879421d48aa782d4ea97ee8358&esurl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&db=tsc-0.isc-0.pp-0.fetch-1.mo-1.iframe-0.ww-0.qsa-1.srv_cfg-1.src_pid-1';

const LEAD = 'https://alb.reddit.com/rp.gif?ts=1783195124437&id=a2_testpixel001&event=Lead&m.value=&m.valueDecimal=12%2C55&m.currency=EUR&m.transactionId=526c82442fb5fec5dde4033cb8e8d5d23a66b3cb02c4ad37477afb31d90327c3&m.customEventName=&m.products=&m.conversionId=526c82442fb5fec5dde4033cb8e8d5d23a66b3cb02c4ad37477afb31d90327c3&uuid=0c7941b1-3509-45a8-9eb8-8a6ff0c50f65&aaid=&external_id=03c28c828cc2b2558d975399118363de6dbf96a7ac82dfa53621c524319349a1&idfa=&integration=gtm&partner=&partner_version=1.0.4%3A1&opt_out=0&sh=1920&sw=1080&v=rdt_bdf78704&dpm=&dpcc=&dprc=&em=8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa&pn=2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08&auto_em=bc4795ee8be72a7a92a83a67b1ad3de72cc8013906871a9e9f3ed884d7c4a4f5%2C8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa%2C8d9b70fd20e23919cfe664ea5e571db39d72ba1bf17bf57e909ada24be9aa3aa&auto_pn=495~c5c1993db37facdfcc943bdcf526489bf9b04abf3abf6e9696510e7d0141e0b3%7C495~2e24253f8ed2a729e4e3363860fe5feba7f5c81a9732d2edcefd95241a718d08%7C225~01cd4d5a7001275381f4c2a3d239f5116fac598dd6d3bfee672c0b1519744e6e%7C225~120003dc53a5d1c40d3631e5cd45e762310768b34a5676260e860e06997c1df4%7C225~ebbd14c3cfad8774248530784eb7dd611cc612879421d48aa782d4ea97ee8358&esurl=https%3A%2F%2Fatomkraftwerke24.de%2Fectest.html&db=tsc-0.srv_cfg-1.src_pid-1';

test('real PageVisit: account id, event, page url, identifiers', () => {
  const r = parseRedditRequest(PAGEVISIT, null);
  assert.ok(r, 'should be recognised as a Reddit Pixel hit');
  assert.equal(r.provider, 'reddit');
  assert.equal(r.transport, 'standard');
  assert.equal(r.method, 'GET');
  assert.equal(r.event, 'PageVisit');
  assert.equal(r.standardEvent, true);
  assert.equal(r.pixelId, 'a2_testpixel001');
  assert.equal(r.pageUrl, 'https://atomkraftwerke24.de/ectest.html');
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 0, address: 0 });
  assert.equal(r.revenue, null);                          // m.value empty, no valueDecimal
  assert.equal(r.conversionId, 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3');
});

test('real PageVisit: manual + auto identifiers, external id', () => {
  const r = parseRedditRequest(PAGEVISIT, null);
  assert.equal(r.flags.advancedMatching, true);          // em + pn
  assert.equal(r.flags.autoMatching, true);              // auto_em + auto_pn
  assert.equal(r.flags.externalId, true);
  assert.equal(r.flags.optOut, false);
  assert.equal(r.userData.em.hashed, true);
  assert.equal(r.userData.auto_em.list.length, 2);
  assert.equal(r.userData.auto_pn.list.length, 4);
  assert.equal(r.userData.auto_pn.list[0].weight, '495');
  assert.equal(r.externalId, '03c28c828cc2b2558d975399118363de6dbf96a7ac82dfa53621c524319349a1');
});

test('real Lead: revenue (comma decimal), transaction id, dedup', () => {
  const r = parseRedditRequest(LEAD, null);
  assert.ok(r);
  assert.equal(r.event, 'Lead');
  assert.equal(r.standardEvent, true);
  assert.deepEqual(r.revenue, { value: '12,55', currency: 'EUR' });
  assert.equal(r.transactionId, '526c82442fb5fec5dde4033cb8e8d5d23a66b3cb02c4ad37477afb31d90327c3');
  assert.equal(r.conversionId, '526c82442fb5fec5dde4033cb8e8d5d23a66b3cb02c4ad37477afb31d90327c3');
  assert.equal(r.flags.dedup, true);
  assert.equal(r.userData.auto_em.list.length, 3);       // one new + two repeats
  assert.equal(r.userData.auto_pn.list.length, 5);
  assert.deepEqual(r.identifiers, { email: 1, phone: 1, name: 0, address: 0 });
});

test('custom event: name carried in m.customEventName', () => {
  const url = 'https://alb.reddit.com/rp.gif?id=a2_testpixel001&event=Custom&m.customEventName=MyGoal';
  const r = parseRedditRequest(url, null);
  assert.ok(r);
  assert.equal(r.event, 'Custom');
  assert.equal(r.flags.custom, true);
  assert.equal(r.customEventName, 'MyGoal');
});

test('helpers: user data + summary + conversion', () => {
  const ud = extractRedditUserData({ em: 'a'.repeat(64), pn: '', external_id: 'b'.repeat(64), auto_em: 'c'.repeat(64) + ',' + 'd'.repeat(64), auto_pn: '' });
  assert.ok(ud.em && ud.em.hashed === true);
  assert.ok(ud.external_id);
  assert.equal(ud.auto_em.list.length, 2);
  assert.equal(ud.pn, undefined);
  assert.deepEqual(summarizeRedditIdentifiers(ud), { email: 1, phone: 0, name: 0, address: 0 });

  assert.equal(extractRedditConversion({ value: '', valueDecimal: '', currency: '' }), null);
  assert.deepEqual(extractRedditConversion({ valueDecimal: '9,99', currency: 'EUR' }), { value: '9,99', currency: 'EUR' });
});

test('detection: host, path, required id', () => {
  assert.equal(isRedditHost('alb.reddit.com'), true);
  assert.equal(isRedditHost('reddit.com'), false);
  assert.equal(isRedditHost('pixel-config.reddit.com'), false);
  assert.equal(isRedditHost('ct.pinterest.com'), false);

  assert.equal(parseRedditRequest('https://ct.pinterest.com/rp.gif?id=a2_x', null), null);      // wrong host
  assert.equal(parseRedditRequest('https://alb.reddit.com/other?id=a2_x', null), null);         // wrong path
  assert.equal(parseRedditRequest('https://alb.reddit.com/rp.gif?event=PageVisit', null), null); // no id
});
