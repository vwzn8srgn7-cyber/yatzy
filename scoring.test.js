const assert = require('assert');
const { score, total, bonus } = require('./scoring.js');

const t = (cat, dice, expected) =>
  assert.strictEqual(score(cat, dice), expected, `${cat} ${dice} sollte ${expected} sein`);

t('ones', [1, 1, 3, 4, 1], 3);
t('sixes', [6, 6, 1, 2, 3], 12);
t('pair', [3, 3, 5, 5, 1], 10);
t('pair', [1, 2, 3, 4, 6], 0);
t('twoPairs', [3, 3, 5, 5, 1], 16);
t('twoPairs', [3, 3, 3, 3, 1], 0);
t('three', [4, 4, 4, 2, 1], 12);
t('four', [2, 2, 2, 2, 6], 8);
t('four', [2, 2, 2, 6, 6], 0);
t('small', [5, 4, 3, 2, 1], 15);
t('small', [2, 3, 4, 5, 6], 0);
t('large', [6, 5, 4, 3, 2], 20);
t('full', [2, 2, 3, 3, 3], 13);
t('full', [4, 4, 4, 4, 4], 0);
t('chance', [6, 6, 1, 2, 3], 18);
t('yatzy', [5, 5, 5, 5, 5], 75);
t('yatzy', [1, 1, 1, 1, 1], 55);
t('yatzy', [6, 6, 6, 6, 6], 80);
t('yatzy', [5, 5, 5, 5, 4], 0);

// Bonus ab 63 Punkten im oberen Block
const full = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }; // 63
assert.strictEqual(bonus(full), 50);
assert.strictEqual(total(full), 113);
assert.strictEqual(bonus({ ones: 1 }), 0);
// Bonus erst, wenn alle sechs oberen Felder gefüllt sind
const fiveOfSix = { ones: 5, twos: 10, threes: 15, fours: 20, fives: 25 }; // 75, aber Sechser fehlt noch
assert.strictEqual(bonus(fiveOfSix), 0);
assert.strictEqual(total(fiveOfSix), 75);
assert.strictEqual(bonus({ ...fiveOfSix, sixes: 0 }), 50);
assert.strictEqual(bonus({ ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 }), 0);

console.log('Alle Tests bestanden');
