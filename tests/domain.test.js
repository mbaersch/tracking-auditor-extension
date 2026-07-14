import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain, isSameSite, isSameSiteUrl } from '../lib/domain.js';

test('registrableDomain: plain TLDs collapse to eTLD+1', () => {
  assert.equal(registrableDomain('happytagging.taggrs.io'), 'taggrs.io');
  assert.equal(registrableDomain('taggrs.io'), 'taggrs.io');
  assert.equal(registrableDomain('pagead2.googlesyndication.com'), 'googlesyndication.com');
  assert.equal(registrableDomain('www.google.de'), 'google.de');
});

test('registrableDomain: two-level ccTLD registries keep three labels', () => {
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('a.b.example.com.au'), 'example.com.au');
});

test('registrableDomain: edge cases pass through', () => {
  assert.equal(registrableDomain('localhost'), 'localhost');
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrableDomain(''), '');
  assert.equal(registrableDomain('Example.IO'), 'example.io');   // lowercased
  assert.equal(registrableDomain('taggrs.io.'), 'taggrs.io');    // trailing dot
});

test('isSameSite: subdomain vs apex on the same registrable domain', () => {
  assert.equal(isSameSite('happytagging.taggrs.io', 'taggrs.io'), true);
  assert.equal(isSameSite('happytagging.taggrs.io', 'www.taggrs.io'), true);
  assert.equal(isSameSite('pagead2.googlesyndication.com', 'taggrs.io'), false);
  assert.equal(isSameSite('sgtm.othervendor.io', 'example.com'), false);
  assert.equal(isSameSite('', 'taggrs.io'), false);
});

test('isSameSiteUrl: compares a host against a full page URL, never assumes', () => {
  assert.equal(isSameSiteUrl('happytagging.taggrs.io', 'https://www.taggrs.io/de/'), true);
  assert.equal(isSameSiteUrl('abc.taggrs.io', 'https://example.com/'), false);
  assert.equal(isSameSiteUrl('sgtm.example.com', 'https://www.example.com/checkout'), true);
  assert.equal(isSameSiteUrl('sgtm.example.com', undefined), false);   // no page url → no claim
  assert.equal(isSameSiteUrl('sgtm.example.com', 'not a url'), false); // unparseable → no claim
});
