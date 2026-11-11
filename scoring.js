// Yatzy-Punktelogik (skandinavische Regeln, 15 Kategorien). Läuft im Browser und in Node.
(function (root) {
  const CATEGORIES = [
    { id: 'ones', label: 'Einser', upper: true },
    { id: 'twos', label: 'Zweier', upper: true },
    { id: 'threes', label: 'Dreier', upper: true },
    { id: 'fours', label: 'Vierer', upper: true },
    { id: 'fives', label: 'Fünfer', upper: true },
    { id: 'sixes', label: 'Sechser', upper: true },
    { id: 'pair', label: 'Ein Paar' },
    { id: 'twoPairs', label: 'Zwei Paare' },
    { id: 'three', label: 'Drilling' },
    { id: 'four', label: 'Vierling' },
    { id: 'small', label: 'Kleine Strasse' },
    { id: 'large', label: 'Grosse Strasse' },
    { id: 'full', label: 'Full House' },
    { id: 'chance', label: 'Chance' },
    { id: 'yatzy', label: 'Yatzy' },
  ];
  const UPPER_IDS = CATEGORIES.filter((c) => c.upper).map((c) => c.id);
  const BONUS_THRESHOLD = 63;
  const BONUS_POINTS = 50;

  function counts(dice) {
    const c = [0, 0, 0, 0, 0, 0, 0]; // Index 1..6
    dice.forEach((d) => c[d]++);
    return c;
  }
  const sum = (dice) => dice.reduce((a, b) => a + b, 0);

  // Höchster Wert mit mindestens n Würfeln, sonst 0
  function highestWith(c, n) {
    for (let v = 6; v >= 1; v--) if (c[v] >= n) return v;
    return 0;
  }

  function score(cat, dice) {
    const c = counts(dice);
    const idx = UPPER_IDS.indexOf(cat);
    if (idx >= 0) return c[idx + 1] * (idx + 1);
    switch (cat) {
      case 'pair':
        return highestWith(c, 2) * 2;
      case 'twoPairs': {
        const pairs = [];
        for (let v = 6; v >= 1; v--) if (c[v] >= 2) pairs.push(v);
        return pairs.length >= 2 ? (pairs[0] + pairs[1]) * 2 : 0;
      }
      case 'three':
        return highestWith(c, 3) * 3;
      case 'four':
        return highestWith(c, 4) * 4;
      case 'small':
        return [1, 2, 3, 4, 5].every((v) => c[v] === 1) ? 15 : 0;
      case 'large':
        return [2, 3, 4, 5, 6].every((v) => c[v] === 1) ? 20 : 0;
      case 'full': {
        const three = [1, 2, 3, 4, 5, 6].find((v) => c[v] === 3);
        const two = [1, 2, 3, 4, 5, 6].find((v) => c[v] === 2);
        return three && two ? sum(dice) : 0;
      }
      case 'chance':
        return sum(dice);
      case 'yatzy':
        return c.some((n) => n === 5) ? 50 + 5 * dice[0] : 0; // 50 + 5 × Augenzahl (1er = 55 … 6er = 80)
    }
    throw new Error('Unbekannte Kategorie: ' + cat);
  }

  function upperSum(scores) {
    return UPPER_IDS.reduce((a, id) => a + (scores[id] || 0), 0);
  }
  function bonus(scores) {
    // Bonus erst, wenn alle sechs oberen Felder (Einser bis Sechser) ausgefüllt sind und zusammen mindestens 63 ergeben
    const allFilled = UPPER_IDS.every((id) => scores[id] !== undefined);
    return allFilled && upperSum(scores) >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
  }
  function total(scores) {
    return Object.values(scores).reduce((a, b) => a + b, 0) + bonus(scores);
  }

  const api = { CATEGORIES, BONUS_THRESHOLD, BONUS_POINTS, score, upperSum, bonus, total };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof self !== 'undefined' ? self : this);
