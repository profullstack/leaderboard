import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commissionLadder } from '../src/ladder.js';

test('the announced ladder: 20% to 80%, five points per property and niche', () => {
  const l = commissionLadder();
  assert.equal(l.rate({}), 20);
  assert.equal(l.rate({ properties: 1 }), 25);
  assert.equal(l.rate({ properties: 1, niches: 1 }), 30);
  assert.equal(l.rate({ properties: 6, niches: 6 }), 80);
  assert.equal(l.rate({ properties: 60, niches: 60 }), 80, 'capped');
  assert.equal(l.rate({ properties: -3, niches: 'x' }), 20, 'junk is zero');
});

test('next() names the cheapest step up and stops at the cap', () => {
  const l = commissionLadder();
  assert.deepEqual(l.next({}), { add: 'property', rate: 25, from: 20, gain: 5, toCap: 60 });
  assert.equal(l.next({ properties: 6 }).add, 'niche', 'properties maxed, so a niche');
  assert.equal(l.next({ properties: 6, niches: 6 }), null);
});

test('custom shape and metric names', () => {
  const l = commissionLadder({ base: 10, cap: 50, perProperty: 10, perNiche: 20, maxProperties: 2, maxNiches: 1, propertiesMetric: 'sites', nichesMetric: 'topics' });
  assert.equal(l.rate({ sites: 2, topics: 1 }), 50);
  assert.equal(l.rate({ sites: 1 }), 20);
  assert.equal(l.table().length, 6);
  assert.match(l.describe(), /Start at 10%/);
});
