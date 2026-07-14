import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTaggrsKey,
  looksLikeTaggrsLoader,
  parseTaggrsEnvelope,
  isTaggrsRequest,
  decryptTaggrsBlob,
  decodeTaggrsRequest,
} from '../lib/taggrs.js';
import { parseGa4Request } from '../lib/ga4.js';

// ===========================================================================
// REAL fixture — captured from a taggrs custom loader on taggrs.io (client
// mzdszqmamq, sGTM host happytagging.taggrs.io). The key is hardcoded in the
// loader body; the envelope is the exact POST payload that hid a GA4 scroll hit.
// ===========================================================================
const KEY = 'e0b4809b403a0e2c59897bb966b05251';
const LOADER_SNIPPET = `(function () {
  const CLIENT_ID = 'mzdszqmamq';
  const GTM_SERVER_URL = 'https://happytagging.taggrs.io';
  const ENCRYPTION_KEY = 'e0b4809b403a0e2c59897bb966b05251';
  async function encrypt(dataString) {
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    return \`\${ivHex}:\${encryptedHex}\`;
  }
})();`;

const ENVELOPE_U = 'c2b62d4f00c37ee4bd541435:1f24bc2c576aefd93bbfd674abc41eb0fc75fdd5f817bd7795d56a14c6b577a8cdcaa0c21644677ad21f3c535e22d3c3e8e571819905b4c4a077e650dd3e7d7c8c02bd8c27cc40ce29b27a3dbba2b561d1503b059e39d36c90669fc0de0208a74a1ff733d5e0161e85d60f478019f3f669cad2e5beb103829649431ec94850fd0b8fd099c6a3a4a07cf10f770bafc2a70e83f72b3af97f3fdb4e17cb2de2cbb36657c90b96a16f25499bc82ca1d8559c1dd4ef0cc4518d359fd73175db331c99612740aca2022d9b2bcf4d87c9c4f3f80c1bdbe26ba5daac907c68256d812c8159d87cf313c39747413da6824d4eedfae5a9233bcb51c3a3f8a6d468a7da387b4304c1deaa2ee5f6aca9a190f51974614cc8666d997ebaa80c68bd936ceb9347623b525b845f4e3213a6b138ce8b03758ff689d0ee33192688517432e93e475a38c25425b88c0d357616de31e50c46ff3dd84fc7c3485448c5c2fcc2ede78d52bdb057e5bb498e16130b7033c273da7776f66b661d61dd7dbf3aaed987829f07b53a8284a7901c0ba27af45d721b7344185ee086ea17745baf18e1cabc2a3fc4ce710155fdfa8528668f6e19b58dd2c329a5bd7c0d3e7a8affffd2f502ceed202a883f69b83aab864f12101f555e51cd8e5630707cdbf769865069c128aa4140d0b68f957347531c247f57831ce3903c5a570352556b1d06d6f76630069d9a178ebb3925fa220a6a77bd3512429bd3e3c2ff5ef1430730c4b64f762ccfba73868203da12d152c45d8677a8c7181f9b74b10fe4299dc2eebc69cea5dfe0d97e334f62ab271dd6fc41ddfec2eb7b47091322bb98ff81b1b59802cd6890200434e3f2d2e062d1e57fbbd6cef50f7e233e75c6c8c00cf0e1b97de1b6cf98a79e0e8d050e04811884fee594e74719a5175a5f9b8fe7804c2416909b2ec3e73a2ee984be72fb47f86cb136a62480a41c916b090517496241abd1de4f96426e2d045289fda79426379a6b72c5477eaafd5edd1509a9edfd698c5b62a80485559959c072d2c56fe96a6a1bf67e30b5db7cc141699fd86ed4a12f05b1f8ea1525eb7b8fd80a5d72d1907f444d9bad853340f866faa4872819c8fbabe86c458a17dadbced9aebd948caf35b508687b6a983cf8330f04fa7cf5d7831db923324c9401265416896a77e656a7d554905cc01735dcfb7892bf328e90e223b58287e2af564ec81d1080a5f92c702272864bcd68bf567caf022113439f56a1722bc70f6291add081814a9b1efc242415d0cea5706ce9a4c9e8ec9b3097e745407e23fc08830a714e806d97b6f03a7089915f0e2840a52ff7b8787223a50958adec8eb863177fcfb4b5641edba7db372ecbf09cee64c4b883c75b2a216df8a7c37e53823d2008cd4686672f0ae480b77630a4c97fa36bbed7d384affd37f9fae69ddbefc5346fad958b861da59c1105239ce99cf9495cec99b08f46cfe1d4f36cf77527b6321b24ada2ae28a4c17f85d015a90465c3f29d08a36bcb581494003b2efb2b31de5775fdee4722502bd012ecec3b73b53a55c2ea71f1f0a9f8623f672c39ae3408de2b81c452349f12485783c7501a96d6a3d733181516192b8c87d31b98f1e9fd30173c8ab7620413bfddf489aef7462ebbf799bb696d2809fb150870e2de0d21468a540262b9630e5b9476088709617bf3f65cd0771e0cf0304781822aae7afc1879d3a5b9ba598be224e6ffeeda06ef5c61acb431404ad2944c9bc90223a7e4d5bc1f2cb73163352111616579c1904e406bd987576be8dbacc4a9faf47675e34cad603d014e3595f38a7542f4ca7e84656364780a4d27bfd0e32108';
const POST_URL = 'https://happytagging.taggrs.io/mzdszqmamq';
const ENVELOPE = JSON.stringify({ m: 'GET', u: ENVELOPE_U });

// --- key extraction --------------------------------------------------------
test('extractTaggrsKey pulls the hardcoded AES key from the loader body', () => {
  assert.equal(extractTaggrsKey(LOADER_SNIPPET), KEY);
  assert.equal(extractTaggrsKey('var x = 1;'), null);
});

test('looksLikeTaggrsLoader needs the key AND a taggrs marker', () => {
  assert.equal(looksLikeTaggrsLoader(LOADER_SNIPPET), true);
  // A stray 32-hex constant in an unrelated script must not match.
  assert.equal(looksLikeTaggrsLoader("const ENCRYPTION_KEY = 'e0b4809b403a0e2c59897bb966b05251';"), false);
});

// --- envelope detection (no key needed) ------------------------------------
test('parseTaggrsEnvelope splits the POST envelope into iv/ct + client id', () => {
  const env = parseTaggrsEnvelope(POST_URL, ENVELOPE);
  assert.ok(env);
  assert.equal(env.method, 'GET');                 // original request method
  assert.equal(env.host, 'happytagging.taggrs.io');
  assert.equal(env.clientId, 'mzdszqmamq');
  assert.equal(env.u.iv.length, 24);               // 12-byte IV
  assert.equal(env.b, null);
  assert.equal(isTaggrsRequest(POST_URL, ENVELOPE), true);
});

test('parseTaggrsEnvelope handles the GET ?p= transport', () => {
  const env = parseTaggrsEnvelope('https://happytagging.taggrs.io/mzdszqmamq?p=' + ENVELOPE_U, null);
  assert.ok(env);
  assert.equal(env.method, 'GET');
  assert.equal(env.u.iv, 'c2b62d4f00c37ee4bd541435');
});

test('non-taggrs requests are ignored', () => {
  assert.equal(parseTaggrsEnvelope('https://example.com/g/collect?v=2', null), null);
  assert.equal(isTaggrsRequest('https://happytagging.taggrs.io/mzdszqmamq', '{"foo":"bar"}'), false);
});

// --- the real round trip ---------------------------------------------------
test('decodeTaggrsRequest decrypts the real envelope to the hidden GA4 scroll hit', async () => {
  const dec = await decodeTaggrsRequest(POST_URL, ENVELOPE, KEY);
  assert.ok(dec);
  assert.equal(dec.host, 'happytagging.taggrs.io');
  assert.ok(dec.url.startsWith('https://happytagging.taggrs.io/g/collect?'));
  assert.match(dec.url, /[?&]en=scroll(&|$)/);
  assert.match(dec.url, /[?&]tid=G-RLBMR4Z9MK(&|$)/);
  assert.match(dec.url, /[?&]epn\.percent_scrolled=90(&|$)/);
});

test('a wrong key fails the GCM auth tag (rejects, never returns garbage)', async () => {
  await assert.rejects(
    decodeTaggrsRequest(POST_URL, ENVELOPE, 'ffffffffffffffffffffffffffffffff'));
});

// --- end-to-end: decrypted hit flows through the normal GA4 parser ---------
test('decrypted taggrs hit parses as a first-party GA4 scroll on the site', async () => {
  const dec = await decodeTaggrsRequest(POST_URL, ENVELOPE, KEY);
  // Inspected page is taggrs.io; the sGTM host is a subdomain of it → first-party.
  const r = parseGa4Request(dec.url, dec.postData, 'https://taggrs.io/de/');
  assert.ok(r);
  assert.equal(r.provider, 'ga4');
  assert.equal(r.en, 'scroll');
  assert.equal(r.tid, 'G-RLBMR4Z9MK');
  assert.equal(r.transport, 'first-party');         // happytagging.taggrs.io ↔ taggrs.io
});
