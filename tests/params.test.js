import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashAlgo, looksHashed, algoLabel, algoNote, EXPECTED_ALGO } from '../lib/params.js';

const SHA256 = 'a'.repeat(64);
const SHA1 = 'b'.repeat(40);
const MD5 = 'c'.repeat(32);
const B64URL_SHA256 = 'AbCd-_0123456789AbCd-_0123456789AbCd-_01234'; // 43 chars, base64url

test('hashAlgo detects hash form by shape', () => {
  assert.equal(hashAlgo(SHA256), 'sha256');
  assert.equal(hashAlgo(SHA1), 'sha1');
  assert.equal(hashAlgo(MD5), 'md5');
  assert.equal(hashAlgo(B64URL_SHA256), 'sha256');       // Google Ads / GA4 form-data em
  assert.equal(hashAlgo(B64URL_SHA256 + '='), 'sha256'); // with one pad char
});

test('hashAlgo returns null for plaintext / junk', () => {
  assert.equal(hashAlgo('test@example.com'), null);
  assert.equal(hashAlgo('491701234567'), null);
  assert.equal(hashAlgo(''), null);
  assert.equal(hashAlgo('deadbeef'), null);              // hex but wrong length
  assert.equal(hashAlgo(null), null);
  assert.equal(hashAlgo(12345), null);
});

test('looksHashed is the boolean of hashAlgo', () => {
  assert.equal(looksHashed(SHA256), true);
  assert.equal(looksHashed(MD5), true);
  assert.equal(looksHashed('plaintext'), false);
});

test('algoLabel renders human labels, plaintext stated plainly', () => {
  assert.equal(algoLabel('sha256'), 'SHA-256');
  assert.equal(algoLabel('sha1'), 'SHA-1');
  assert.equal(algoLabel('md5'), 'MD5');
  assert.equal(algoLabel(null), 'not hashed');
});

test('algoNote only fires on a recognised-but-wrong algo', () => {
  // SHA-256 everywhere is fine → no note.
  assert.equal(algoNote('snapchat', 'sha256'), '');
  // MD5 on a SHA-256-only provider → note.
  assert.equal(algoNote('snapchat', 'md5'), 'expects SHA-256');
  assert.equal(algoNote('reddit', 'sha1'), 'expects SHA-256');
  // Pinterest accepts all three → never a note.
  assert.equal(algoNote('pinterest', 'md5'), '');
  assert.equal(algoNote('pinterest', 'sha1'), '');
  // Plaintext (null) is not a wrong-algo case — no note, no leak alarm.
  assert.equal(algoNote('snapchat', null), '');
  // Unknown provider → no expectation → no note.
  assert.equal(algoNote('whatever', 'md5'), '');
});

test('every provider has a declared expected algo', () => {
  for (const p of ['ga4', 'meta', 'uet', 'tiktok', 'pinterest', 'googleads', 'linkedin', 'reddit', 'snapchat']) {
    assert.ok(Array.isArray(EXPECTED_ALGO[p]) && EXPECTED_ALGO[p].length, `missing EXPECTED_ALGO.${p}`);
  }
});
