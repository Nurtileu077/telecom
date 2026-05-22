#!/usr/bin/env bash
# Подготовка данных OSRM для прокладки кабеля.
# Запуск:  ./setup.sh   (затем  docker compose up -d)
set -euo pipefail

# Регион OSM. По умолчанию — весь Казахстан (Geofabrik). Для скорости можно
# подсунуть свой обрезанный .osm.pbf по городу: REGION_URL=file:///path или
# просто положить его в data/region.osm.pbf вручную и пропустить скачивание.
REGION_URL="${REGION_URL:-https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf}"

# Профиль маршрутизации. foot = пешеход: игнорирует односторонки, не штрафует
# развороты → кабель не делает «проехал-развернулся» и не дублируется по обеим
# сторонам дороги. Альтернативы в образе: car, bicycle.
PROFILE="${PROFILE:-foot}"

IMAGE="osrm/osrm-backend:latest"

cd "$(dirname "$0")"
mkdir -p data
cd data

PBF="region.osm.pbf"
if [ ! -f "$PBF" ]; then
  echo "↓ Скачиваю регион: $REGION_URL"
  curl -L --fail -o "$PBF" "$REGION_URL"
else
  echo "• Использую существующий data/$PBF"
fi

echo "▶ osrm-extract (профиль: $PROFILE)"
docker run --rm -v "$PWD:/data" "$IMAGE" osrm-extract -p "/opt/$PROFILE.lua" "/data/$PBF"

echo "▶ osrm-partition"
docker run --rm -v "$PWD:/data" "$IMAGE" osrm-partition /data/region.osrm

echo "▶ osrm-customize"
docker run --rm -v "$PWD:/data" "$IMAGE" osrm-customize /data/region.osrm

echo
echo "✓ Данные готовы. Запуск сервера:"
echo "    docker compose up -d"
echo "  Проверка:  curl 'http://localhost:5000/route/v1/$PROFILE/76.9,43.25;76.95,43.25?overview=false'"
