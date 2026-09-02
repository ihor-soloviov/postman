/**
 * Задача комівояжера із поверненням у депо.
 *
 * Вузол 0 — відділення пошти. Маршрут завжди 0 → ...точки... → 0.
 * Саме тут з'являються "трикутники", які ти помітив на практиці: алгоритм не
 * будує коло по колу, а мінімізує сумарну вартість, тому частина адрес
 * природно лишається на зворотний шлях, якщо так дешевше.
 *
 * Алгоритм: найближчий сусід + випадкові перезапуски, далі локальне
 * покращення 2-opt (розворот ділянки) та Or-opt (перенос 1-3 точок в інше
 * місце маршруту, за потреби задом наперед). Матриця може бути несиметричною
 * (односторонній рух), тому вартість розвороту рахуємо чесно.
 */

export type Tour = number[]; // [0, ..., 0]

const TIME_BUDGET_MS = 2500;

export function tourCost(cost: number[][], tour: Tour): number {
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) total += cost[tour[i]][tour[i + 1]];
  return total;
}

function nearestNeighbour(cost: number[][], start: number, rng: () => number): Tour {
  const size = cost.length;
  const unvisited = new Set<number>();
  for (let i = 1; i < size; i++) unvisited.add(i);
  const tour: Tour = [0];
  let current = start;
  if (start !== 0) {
    tour.push(start);
    unvisited.delete(start);
  }
  while (unvisited.size) {
    let best = -1;
    let bestCost = Infinity;
    for (const candidate of unvisited) {
      // Дрібний шум дає різні старти при перезапусках і рятує від локальних ям.
      const value = cost[current][candidate] * (1 + rng() * 0.02);
      if (value < bestCost) {
        bestCost = value;
        best = candidate;
      }
    }
    tour.push(best);
    unvisited.delete(best);
    current = best;
  }
  tour.push(0);
  return tour;
}

/** Розворот ділянки tour[i..j]. Для несиметричної матриці враховуємо зміну внутрішніх ребер. */
function twoOpt(cost: number[][], tour: Tour): boolean {
  const last = tour.length - 1;
  let improved = false;
  for (let i = 1; i < last - 1; i++) {
    let reverseDelta = 0;
    for (let j = i + 1; j < last; j++) {
      if (j > i) {
        reverseDelta += cost[tour[j]][tour[j - 1]] - cost[tour[j - 1]][tour[j]];
      }
      const delta =
        cost[tour[i - 1]][tour[j]] +
        cost[tour[i]][tour[j + 1]] -
        cost[tour[i - 1]][tour[i]] -
        cost[tour[j]][tour[j + 1]] +
        reverseDelta;
      if (delta < -1e-9) {
        const segment = tour.slice(i, j + 1).reverse();
        tour.splice(i, segment.length, ...segment);
        improved = true;
        reverseDelta = 0;
        // Ділянку змінено — перерахунок від нового i.
        break;
      }
    }
    if (improved) return true;
  }
  return false;
}

/** Перенесення ділянки з 1-3 точок в інше місце маршруту (з розворотом або без). */
function orOpt(cost: number[][], tour: Tour): boolean {
  const last = tour.length - 1;
  for (let length = 1; length <= 3; length++) {
    for (let i = 1; i + length <= last; i++) {
      const head = tour[i];
      const tail = tour[i + length - 1];
      const gain =
        cost[tour[i - 1]][head] + cost[tail][tour[i + length]] - cost[tour[i - 1]][tour[i + length]];
      let innerReverse = 0;
      for (let k = i; k < i + length - 1; k++) {
        innerReverse += cost[tour[k + 1]][tour[k]] - cost[tour[k]][tour[k + 1]];
      }
      for (let p = 0; p < last; p++) {
        if (p >= i - 1 && p <= i + length - 1) continue;
        const a = tour[p];
        const b = tour[p + 1];
        const base = cost[a][b];
        const forward = cost[a][head] + cost[tail][b] - base;
        const backward = cost[a][tail] + cost[head][b] - base + innerReverse;
        const reversed = backward < forward;
        const delta = (reversed ? backward : forward) - gain;
        if (delta < -1e-9) {
          const segment = tour.splice(i, length);
          if (reversed) segment.reverse();
          const target = p < i ? p + 1 : p + 1 - length;
          tour.splice(target, 0, ...segment);
          return true;
        }
      }
    }
  }
  return false;
}

function improve(cost: number[][], tour: Tour, deadline: number): Tour {
  let working = tour.slice();
  let guard = 0;
  const maxRounds = 20000;
  while (guard++ < maxRounds && Date.now() < deadline) {
    if (twoOpt(cost, working)) continue;
    if (orOpt(cost, working)) continue;
    break;
  }
  return working;
}

export function solveTour(cost: number[][]): { tour: Tour; cost: number } {
  const size = cost.length;
  if (size <= 2) {
    const tour = size === 2 ? [0, 1, 0] : [0, 0];
    return { tour, cost: tourCost(cost, tour) };
  }

  // Детермінований генератор: однаковий вхід дає однаковий маршрут.
  let seed = 1234567;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const deadline = Date.now() + TIME_BUDGET_MS;
  let best = improve(cost, nearestNeighbour(cost, 0, () => 0), deadline);
  let bestCost = tourCost(cost, best);

  const restarts = size <= 12 ? 4 : size <= 40 ? 12 : 6;
  for (let attempt = 0; attempt < restarts && Date.now() < deadline; attempt++) {
    const start = 1 + Math.floor(rng() * (size - 1));
    const candidate = improve(cost, nearestNeighbour(cost, start, rng), deadline);
    const candidateCost = tourCost(cost, candidate);
    if (candidateCost < bestCost - 1e-9) {
      best = candidate;
      bestCost = candidateCost;
    }
  }
  return { tour: best, cost: bestCost };
}
