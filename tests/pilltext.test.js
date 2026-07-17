import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, idList, PILL_MAX } from '../lib/pilltext.js';

// The pills these back show whatever the site sent. The cases below are the
// shapes that used to blow the card open: a basket of ids in one param, and a
// single value long enough to be a paragraph.

test('clip: short values pass through untouched', () => {
  assert.equal(clip('41604161044541'), '41604161044541');
  assert.equal(clip('  padded  '), 'padded');
  assert.equal(clip(''), '');
  assert.equal(clip(null), '');
  assert.equal(clip(undefined), '');
  assert.equal(clip(12345), '12345');
});

test('clip: a value at the limit is not clipped, one past it is', () => {
  const exact = 'x'.repeat(PILL_MAX);
  assert.equal(clip(exact), exact);
  const over = 'x'.repeat(PILL_MAX + 1);
  assert.equal(clip(over), 'x'.repeat(PILL_MAX - 1) + '…');
  assert.equal(clip(over).length, PILL_MAX);
});

test('clip: the ellipsis does not hang off a trailing space', () => {
  assert.equal(clip('word ' + 'y'.repeat(30), 6), 'word…');
});

test('clip: honours a caller max', () => {
  assert.equal(clip('abcdefghij', 5), 'abcd…');
});

test('idList: splits a comma-separated basket, trims and drops blanks', () => {
  assert.deepEqual(idList('41604161044541,41604161077309,54250477224321'),
    ['41604161044541', '41604161077309', '54250477224321']);
  assert.deepEqual(idList('a , ,b,'), ['a', 'b']);
  assert.deepEqual(idList('sku-1'), ['sku-1']);
  assert.deepEqual(idList(''), []);
  assert.deepEqual(idList(null), []);
});
