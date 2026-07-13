import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHubspotRequest,
  isHubspotHost,
  extractHubspotIdentify,
  extractHubspotUserData,
  summarizeHubspotIdentifiers,
  extractHubspotProperties,
} from '../lib/hubspot.js';

// Real hits captured on Markus' stage (uniorg.de). The hub id / visitor tokens
// are the actual captured values; identify uses fantasy contact data.
const PAGEVIEW = 'https://track-eu1.hubspot.com/__ptq.gif?k=1&sd=1920x1080&cd=24-bit&cs=UTF-8&ln=de-de&bfp=00e63ec9928f28f2d526e7bab8305878&v=1.1&a=147292866&rcu=https%3A%2F%2Fwww.uniorg.de%2F&pu=https%3A%2F%2Fwww.uniorg.de%2F&t=UNIORG+-+Beratung%2C+die+sich+auszahlt.+Seit+1974.&cts=1783937751329&vi=1380c106cd176e612b1a11420d30d35b&nc=false&u=226818242.1380c106cd176e612b1a11420d30d35b.1783669943308.1783669943308.1783937475079.2&b=226818242.2.1783937475079&cc=15';

const EVENT = 'https://track-eu1.hubspot.com/__ptbe.gif?n=my_test_event&_property_name=property_value&sd=1920x1080&cd=24-bit&cs=UTF-8&ln=de-de&bfp=00e63ec9928f28f2d526e7bab8305878&v=1.1&a=147292866&rcu=https%3A%2F%2Fwww.uniorg.de%2F&pu=https%3A%2F%2Fwww.uniorg.de%2F&t=UNIORG+-+Beratung%2C+die+sich+auszahlt.+Seit+1974.&cts=1783937823031&vi=1380c106cd176e612b1a11420d30d35b&nc=false&u=226818242.1380c106cd176e612b1a11420d30d35b.1783669943308.1783669943308.1783937475079.2&b=226818242.2.1783937475079&cc=15';

// Custom event AFTER an identify() call — the identify payload rides in `i` as a
// doubly URL-encoded querystring.
const EVENT_IDENTIFY = 'https://track-eu1.hubspot.com/__ptbe.gif?n=my_test_event2&_property_name=property_value&sd=1920x1080&cd=24-bit&cs=UTF-8&ln=de-de&bfp=00e63ec9928f28f2d526e7bab8305878&v=1.1&a=147292866&rcu=https%3A%2F%2Fwww.uniorg.de%2F&pu=https%3A%2F%2Fwww.uniorg.de%2F&t=UNIORG+-+Beratung%2C+die+sich+auszahlt.+Seit+1974.&cts=1783937897903&i=email%3Dvisitor%2540example.com%26firstname%3DJohn%26lastname%3DDoe&vi=1380c106cd176e612b1a11420d30d35b&nc=false&u=226818242.1380c106cd176e612b1a11420d30d35b.1783669943308.1783669943308.1783937475079.2&b=226818242.2.1783937475079&cc=15';

test('host detection: regional + US, rejects others', () => {
  assert.equal(isHubspotHost('track-eu1.hubspot.com'), true);
  assert.equal(isHubspotHost('track.hubspot.com'), true);
  assert.equal(isHubspotHost('track-na1.hubspot.com'), true);
  assert.equal(isHubspotHost('api.hubspot.com'), false);
  assert.equal(isHubspotHost('track-eu1.hubspot.com.evil.com'), false);
});

test('__ptq.gif → page view record', () => {
  const r = parseHubspotRequest(PAGEVIEW, null);
  assert.ok(r);
  assert.equal(r.provider, 'hubspot');
  assert.equal(r.eventType, 'pageview');
  assert.equal(r.event, 'Page View');
  assert.equal(r.accountId, '147292866');
  assert.equal(r.pageUrl, 'https://www.uniorg.de/');
  assert.equal(r.pageTitle, 'UNIORG - Beratung, die sich auszahlt. Seit 1974.');
  assert.equal(r.visitorId, '1380c106cd176e612b1a11420d30d35b');
  assert.equal(r.flags.pageview, true);
  assert.equal(r.flags.identify, false);
  assert.equal(r.userData, null);
  assert.deepEqual(r.identifiers, { email: 0, phone: 0, name: 0, address: 0 });
});

test('__ptbe.gif → custom event with name + property', () => {
  const r = parseHubspotRequest(EVENT, null);
  assert.ok(r);
  assert.equal(r.eventType, 'event');
  assert.equal(r.event, 'my_test_event');
  assert.equal(r.eventNameRaw, 'my_test_event');
  assert.equal(r.flags.customEvent, true);
  assert.deepEqual(r.properties, { property_name: 'property_value' });
  assert.equal(r.userData, null);           // no identify on this one
});

test('identify payload (i) decodes to cleartext user data, reported not-hashed', () => {
  const r = parseHubspotRequest(EVENT_IDENTIFY, null);
  assert.ok(r);
  assert.equal(r.event, 'my_test_event2');
  assert.equal(r.flags.identify, true);
  // Doubly-encoded i= is fully decoded.
  assert.deepEqual(r.identify, { email: 'visitor@example.com', firstname: 'John', lastname: 'Doe' });
  // PII block shape: category + cleartext (algo null → "not hashed").
  assert.equal(r.userData.email.label, 'Email');
  assert.equal(r.userData.email.hashed, false);
  assert.equal(r.userData.email.algo, null);
  assert.equal(r.userData.firstname.label, 'First name');
  assert.equal(r.userData.lastname.label, 'Last name');
  assert.deepEqual(r.identifiers, { email: 1, phone: 0, name: 1, address: 0 });
});

test('non-HubSpot / wrong path returns null', () => {
  assert.equal(parseHubspotRequest('https://track-eu1.hubspot.com/other.gif?a=1', null), null);
  assert.equal(parseHubspotRequest('https://example.com/__ptq.gif?a=1', null), null);
  assert.equal(parseHubspotRequest('https://track-eu1.hubspot.com/__ptq.gif', null), null); // no hub id
});

test('helpers work standalone', () => {
  const id = extractHubspotIdentify('email=a%40b.de&firstname=Max&company=ACME');
  assert.deepEqual(id, { email: 'a@b.de', firstname: 'Max', company: 'ACME' });
  const ud = extractHubspotUserData(id);
  assert.equal(ud.company.bucket, 'other');        // unknown-but-surfaced field
  assert.equal(ud.company.label, 'Company');
  assert.deepEqual(summarizeHubspotIdentifiers(ud), { email: 1, phone: 0, name: 1, address: 0 });
  assert.equal(extractHubspotProperties({ _a: '1', _b: '2', n: 'x' }).a, '1');
  assert.equal(extractHubspotProperties({ n: 'x' }), null);
});
