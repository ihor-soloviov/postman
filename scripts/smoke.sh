#!/usr/bin/env bash
# Наскрізна перевірка після збірки чи оновлення.
# Піднімає власний сервер на вільному порту з тимчасовою базою — реальні дані не чіпає.
#   npm run build && ./scripts/smoke.sh
set -euo pipefail

PORT="${SMOKE_PORT:-3399}"
BASE="http://127.0.0.1:$PORT"
WORK="$(mktemp -d)"
COOKIES="$WORK/cookies.txt"
PASSWORD="smoke-test-password"
FAILED=0

cleanup() {
  [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
  lsof -ti "tcp:$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✘\033[0m %s\n" "$1"; FAILED=1; }
check() { [[ "$2" == "$3" ]] && ok "$1" || fail "$1 (очікував «$3», отримав «$2»)"; }

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
jq_() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})"; }

echo "▸ Чисті функції (координати, відстані, оптимізатор)"
node --experimental-strip-types --no-warnings "$(dirname "$0")/unit.ts" || FAILED=1

echo "▸ Піднімаю сервер на порту $PORT (база в $WORK)"
APP_PASSWORD="$PASSWORD" SECRET_KEY="smoke-secret" ORS_API_KEY="" DB_PATH="$WORK/test.db" \
  npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  sleep 0.5
  [[ "$(code "$BASE/login")" == "200" ]] && break
done

echo "▸ Доступ"
check "API без сесії відмовляє"        "$(code "$BASE/api/trips")" "401"
check "сторінка без сесії веде на вхід" "$(code "$BASE/")" "307"
check "невірний пароль не пускає"       "$(code -X POST "$BASE/api/login" -H 'Content-Type: application/json' -d '{"password":"nope"}')" "401"
check "правильний пароль пускає"        "$(code -c "$COOKIES" -X POST "$BASE/api/login" -H 'Content-Type: application/json' -d "{\"password\":\"$PASSWORD\"}")" "200"
check "маніфест доступний без входу"    "$(code "$BASE/manifest.webmanifest")" "200"
check "service worker доступний"        "$(code "$BASE/sw.js")" "200"

echo "▸ Налаштування"
curl -s -b "$COOKIES" -X PUT "$BASE/api/settings" -H 'Content-Type: application/json' \
  -d '{"depot_label":"Відділення","depot_lat":"51.2167","depot_lon":"24.7097","stop_minutes":"3"}' > /dev/null
check "відділення збережено" \
  "$(curl -s -b "$COOKIES" "$BASE/api/settings" | jq_ 'd.depot_label')" "Відділення"

echo "▸ Побудова маршруту (дві паралельні вулиці, адреси введені вперемішку)"
curl -s -b "$COOKIES" -X POST "$BASE/api/trips" -H 'Content-Type: application/json' -d '{
 "title":"SMOKE","objective":"duration","addresses":[
  {"label":"А 1","lat":51.2200,"lon":24.7097},{"label":"Б 1","lat":51.2200,"lon":24.7150},
  {"label":"А 2","lat":51.2240,"lon":24.7097},{"label":"Б 2","lat":51.2240,"lon":24.7150},
  {"label":"А 3","lat":51.2280,"lon":24.7097},{"label":"Б 3","lat":51.2280,"lon":24.7150}]}' > "$WORK/trip.json"

TRIP=$(jq_ 'd.trip.id' < "$WORK/trip.json")
ORDER=$(jq_ 'd.stops.map(s=>s.label).join(",")' < "$WORK/trip.json")
check "порядок обходу — «туди однією вулицею, назад іншою»" "$ORDER" "А 1,А 2,А 3,Б 3,Б 2,Б 1"
check "усі 6 точок у маршруті" "$(jq_ 'd.stops.length' < "$WORK/trip.json")" "6"
[[ "$(jq_ 'd.trip.plan_distance_m > 0' < "$WORK/trip.json")" == "true" ]] \
  && ok "відстань порахована" || fail "відстань не порахована"
[[ "$(jq_ 'JSON.parse(d.trip.geometry).length > 1' < "$WORK/trip.json")" == "true" ]] \
  && ok "лінія маршруту побудована" || fail "лінія маршруту порожня"

echo "▸ У дорозі"
S1=$(jq_ 'd.stops[0].id' < "$WORK/trip.json")
S2=$(jq_ 'd.stops[1].id' < "$WORK/trip.json")
curl -s -b "$COOKIES" -X PATCH "$BASE/api/trips/$TRIP" -H 'Content-Type: application/json' -d '{"status":"active"}' > /dev/null
curl -s -b "$COOKIES" -X PATCH "$BASE/api/stops/$S1" -H 'Content-Type: application/json' -d '{"status":"done","comment":"домофон не працює"}' > /dev/null
curl -s -b "$COOKIES" -X PATCH "$BASE/api/stops/$S2" -H 'Content-Type: application/json' -d '{"status":"failed","comment":"нікого нема"}' > /dev/null

curl -s -b "$COOKIES" -X POST "$BASE/api/trips/$TRIP/stops" -H 'Content-Type: application/json' \
  -d '{"label":"В 9","lat":51.2255,"lon":24.7125}' > "$WORK/trip2.json"
check "відвідані точки не переставились при перерахунку" \
  "$(jq_ 'd.stops.slice(0,2).map(s=>s.label).join(",")' < "$WORK/trip2.json")" "А 1,А 2"
check "нова адреса потрапила в маршрут" \
  "$(jq_ 'd.stops.some(s=>s.label==="В 9")' < "$WORK/trip2.json")" "true"
check "коментар зберігся" \
  "$(jq_ 'd.stops[0].comment' < "$WORK/trip2.json")" "домофон не працює"

echo "▸ Ручне перетягування"
NEW_ORDER=$(jq_ 'JSON.stringify((()=>{const i=d.stops.map(s=>s.id);[i[3],i[4]]=[i[4],i[3]];return i})())' < "$WORK/trip2.json")
curl -s -b "$COOKIES" -X PATCH "$BASE/api/trips/$TRIP" -H 'Content-Type: application/json' \
  -d "{\"order\":$NEW_ORDER}" > "$WORK/trip3.json"
check "порядок після ручної правки збережено" \
  "$(jq_ 'd.stops[3].label' < "$WORK/trip3.json")" "$(jq_ 'd.stops[4].label' < "$WORK/trip2.json")"

echo "▸ Пам'ять"
curl -s -b "$COOKIES" -X PATCH "$BASE/api/trips/$TRIP" -H 'Content-Type: application/json' -d '{"status":"done"}' > /dev/null
check "поїздка в історії" "$(curl -s -b "$COOKIES" "$BASE/api/trips" | jq_ 'd.trips[0].title')" "SMOKE"
check "довідник адрес наповнився" "$(curl -s -b "$COOKIES" "$BASE/api/addresses" | jq_ 'd.addresses.length')" "7"
AID=$(curl -s -b "$COOKIES" "$BASE/api/addresses?q=$(node -e 'console.log(encodeURIComponent("А 1"))')" | jq_ 'd.addresses[0].id')
check "пошук з пунктуацією знаходить адресу" \
  "$(curl -s -b "$COOKIES" "$BASE/api/addresses?q=$(node -e 'console.log(encodeURIComponent("а, 1."))')" | jq_ 'd.addresses.length>0')" "true"
check "історія коментарів по адресі" \
  "$(curl -s -b "$COOKIES" "$BASE/api/addresses/$AID" | jq_ 'd.history[0].comment')" "домофон не працює"
curl -s -b "$COOKIES" -X PATCH "$BASE/api/addresses/$AID" -H 'Content-Type: application/json' -d '{"note":"код 1234"}' > /dev/null
check "постійна нотатка збережена" \
  "$(curl -s -b "$COOKIES" "$BASE/api/addresses/$AID" | jq_ 'd.address.note')" "код 1234"
check "адресу з історії не можна видалити" \
  "$(code -b "$COOKIES" -X DELETE "$BASE/api/addresses/$AID")" "409"

echo
if [[ $FAILED -eq 0 ]]; then
  printf "\033[32mУсі перевірки пройдено\033[0m\n"
else
  printf "\033[31mЄ помилки\033[0m\n"; exit 1
fi
