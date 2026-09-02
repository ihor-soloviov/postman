#!/usr/bin/env bash
# Резервна копія бази. У crontab: 0 3 * * * /opt/postman/deploy/backup.sh
set -euo pipefail
SRC="${DB_PATH:-/opt/postman/data/postman.db}"
DEST="${BACKUP_DIR:-/opt/postman/backups}"
mkdir -p "$DEST"
# .backup коректно копіює базу навіть під час запису (на відміну від cp)
sqlite3 "$SRC" ".backup '$DEST/postman-$(date +%F).db'"
# Тримаємо копії за останні 30 днів
find "$DEST" -name 'postman-*.db' -mtime +30 -delete
