#!/bin/sh
# Install the nightly demo backup into adili's crontab.
# deploy.sh and bootstrap-stack.sh call this, so a VM rebuild gets the
# schedule again on the next deploy instead of depending on a manual crontab.
set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/../.." && pwd)"
if [ ! -d /opt/adili ] && [ "${ADILI_INSTALL_BACKUP_CRON:-}" != yes ]; then
  echo "Skipping backup cron: this host has no /opt/adili" >&2
  exit 0
fi

if [ "$(id -u)" -eq 0 ]; then
  cron_user="${ADILI_BACKUP_USER:-adili}"
  read_cron() { crontab -u "$cron_user" -l 2>/dev/null || true; }
  write_cron() { crontab -u "$cron_user" -; }
else
  cron_user="$(id -un)"
  read_cron() { crontab -l 2>/dev/null || true; }
  write_cron() { crontab -; }
fi

log="/home/${cron_user}/adili-backup.log"
marker="infra/azure/backup-databases.sh"
job="15 2 * * * ${ROOT}/infra/azure/backup-databases.sh >>${log} 2>&1 && ${ROOT}/infra/azure/verify-restore.sh >>${log} 2>&1"
path_line="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

current="$(read_cron)"
kept="$(printf '%s\n' "$current" | grep -F -v "$marker" | grep -F -v -x "$path_line" || true)"
{
  printf '%s\n' "$path_line"
  printf '%s\n' "$kept" | sed '/^$/d'
  printf '%s\n' "$job"
} | write_cron
echo "Nightly backup cron installed for ${cron_user}"
