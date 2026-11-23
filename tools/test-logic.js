// Fast checks of the rules that keep wrong words out of lessons. Run: npm test
const assert = require('assert');
const dict = require('../dict');
const P = require('../src/js/preprocess');

// dictionary: canonical spelling, inflected forms, phrases, unknown words
assert.strictEqual(dict.lookup('Apple').w, 'apple');
assert.strictEqual(dict.lookup('monday').w, 'Monday');
assert.strictEqual(dict.lookup('went').base, 'go');
assert.strictEqual(dict.lookup('ice cream').m, '冰淇淋');
assert.strictEqual(dict.lookup('app1e'), null);
assert.strictEqual(dict.lookup('libary'), null);
assert.strictEqual(dict.lookup(''), null);

// suggestions for typical OCR slips and misspellings
assert.strictEqual(dict.suggest('app1e')[0], 'apple');
assert.strictEqual(dict.suggest('libary')[0], 'library');
assert.strictEqual(dict.suggest('rnother')[0], 'mother');
assert.strictEqual(dict.suggest('beautifu1')[0], 'beautiful');

// word books: every entry has a word and a meaning, no duplicates inside a book, groups keep list order
const bank = require('../src/data/wordbank.json');
for (const b of bank.books) {
  const seen = new Set();
  for (const e of b.words) {
    assert.ok(/^[A-Za-z][A-Za-z' -]*$/.test(e.w), `bad word in ${b.id}: ${e.w}`);
    assert.ok(e.m && e.m.trim(), `no meaning for ${e.w}`);
    assert.ok(!seen.has(e.w.toLowerCase()), `duplicate ${e.w} in ${b.id}`);
    seen.add(e.w.toLowerCase());
  }
}
assert.deepStrictEqual(bank.books[0].words.slice(0, 3).map((e) => e.w), ['hello', 'hi', 'goodbye']);

// image clean-up: a dark-to-light page with dark "ink" becomes white paper with black ink
const w = 320, h = 200, gray = new Uint8ClampedArray(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = 90 + Math.round((x / w) * 150);
for (let y = 90; y < 110; y++) for (let x = 20; x < 300; x += 12) for (let k = 0; k < 5; k++) gray[y * w + x + k] *= 0.25;
const flat = P.flatten(gray, w, h), bin = P.binarize(flat);
assert.ok(flat[10 * w + 10] > 235 && flat[10 * w + 310] > 235, 'paper should be white on both the dark and the bright side');
assert.ok(bin[100 * w + 22] === 0 && bin[100 * w + 286] === 0, 'ink should stay black on both sides');
assert.ok(bin[50 * w + 22] === 255, 'paper should binarise to white');

console.log('all logic tests passed');
