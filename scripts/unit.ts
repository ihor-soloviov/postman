/**
 * Перевірка чистих функцій — без сервера й мережі.
 *   node --experimental-strip-types scripts/unit.ts
 */
import { parseCoordinates, haversineMeters } from "../lib/geo.ts";
import { solveTour, tourCost } from "../lib/optimize.ts";

let failed = 0;
const ok = (name: string) => console.log(`  \x1b[32m✔\x1b[0m ${name}`);
const bad = (name: string, got: unknown, want: unknown) => {
  console.log(`  \x1b[31m✘\x1b[0m ${name} (очікував ${JSON.stringify(want)}, отримав ${JSON.stringify(got)})`);
  failed = 1;
};
const eq = (name: string, got: unknown, want: unknown) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(name) : bad(name, got, want);

console.log("▸ Розбір координат");
eq("пара чисел", parseCoordinates("47.889298,33.340726"), { lat: 47.889298, lon: 33.340726 });
eq("з пробілом", parseCoordinates("47.889298, 33.340726"), { lat: 47.889298, lon: 33.340726 });
eq("з зайвим хвостом", parseCoordinates("47.889298,33.340726,7144"), { lat: 47.889298, lon: 33.340726 });
eq("посилання Google Maps", parseCoordinates("https://www.google.com/maps/@47.9116,33.3399,17z"),
   { lat: 47.9116, lon: 33.3399 });
eq("google place з !3d!4d", parseCoordinates("https://maps.google.com/maps/place/x/data=!3d47.9116!4d33.3399"),
   { lat: 47.9116, lon: 33.3399 });
eq("geo:", parseCoordinates("geo:47.9116,33.3399"), { lat: 47.9116, lon: 33.3399 });
eq("звичайна адреса — не координати", parseCoordinates("вул. Петра Калнишевського, 9"), null);
eq("будинок і квартира — не координати", parseCoordinates("Шевченка 9, кв. 12"), null);
eq("індекс — не координати", parseCoordinates("50024"), null);
eq("за межами діапазону", parseCoordinates("947.11,33.33"), null);

console.log("▸ Відстані");
const kyivLviv = haversineMeters({ lat: 50.4501, lon: 30.5234 }, { lat: 49.8397, lon: 24.0297 });
Math.abs(kyivLviv / 1000 - 469) < 15
  ? ok("Київ — Львів ≈ 469 км")
  : bad("Київ — Львів", Math.round(kyivLviv / 1000), 469);

console.log("▸ Оптимізатор");
{
  // Депо, далі дві паралельні вулиці по три будинки.
  const pts: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1]];
  const cost = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
  const { tour } = solveTour(cost);
  eq("трикутник: туди однією вулицею, назад іншою", tour, [0, 1, 2, 3, 6, 5, 4, 0]);
  const naive = tourCost(cost, [0, 1, 2, 3, 4, 5, 6, 0]);
  tourCost(cost, tour) < naive ? ok("краще за наївний порядок") : bad("оптимізація", tourCost(cost, tour), `< ${naive}`);
}
{
  // Несиметрична матриця (односторонній рух) — маршрут має лишатись коректним.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i < 40; i++) pts.push([rnd() * 10, rnd() * 10]);
  const cost = pts.map((a, i) =>
    pts.map((b, j) => (i === j ? 0 : Math.hypot(a[0] - b[0], a[1] - b[1]) * (a[0] > b[0] ? 1.15 : 1))),
  );
  const started = Date.now();
  const { tour } = solveTour(cost);
  const inner = tour.slice(1, -1);
  new Set(inner).size === pts.length - 1 && tour[0] === 0 && tour.at(-1) === 0
    ? ok(`41 точка: кожна рівно один раз, ${Date.now() - started} мс`)
    : bad("41 точка", inner.length, pts.length - 1);
}

process.exit(failed);
