#!/usr/bin/env bash
# Cluster Postgres locale e isolato per lo sviluppo.
# Vive in db/.pgdata, non tocca il Postgres globale della macchina.
#   ./db/local.sh start | stop | status | destroy
set -uo pipefail
cd "$(dirname "$0")/.."
. db/pgenv.sh

DATA=db/.pgdata
LOG=db/.pgdata.log

case "${1:-status}" in
  start)
    if [ ! -d "$DATA" ]; then
      echo "creo il cluster in $DATA"
      initdb -D "$DATA" -U "$PGUSER" --auth=trust --encoding=UTF8 >/dev/null || exit 1
    fi
    if pg_ctl -D "$DATA" status >/dev/null 2>&1; then
      echo "gia' avviato su $PGHOST:$PGPORT"; exit 0
    fi
    # socket in /tmp: il percorso del progetto e' troppo lungo per un socket unix
    pg_ctl -D "$DATA" -o "-k /tmp -h $PGHOST -p $PGPORT" -l "$LOG" start >/dev/null || {
      echo "avvio fallito, guarda $LOG" >&2; tail -5 "$LOG"; exit 1; }
    for _ in $(seq 1 25); do psql -d postgres -c 'select 1' >/dev/null 2>&1 && break; sleep 0.4; done
    psql -d postgres -tAc "select 1 from pg_database where datname='$PGDATABASE'" | grep -q 1 \
      || psql -d postgres -q -c "create database $PGDATABASE"
    echo "pronto: postgres://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE"
    ;;
  stop)
    pg_ctl -D "$DATA" stop >/dev/null 2>&1 && echo "fermato" || echo "non era avviato" ;;
  status)
    pg_ctl -D "$DATA" status 2>&1 | head -2 ;;
  destroy)
    pg_ctl -D "$DATA" stop >/dev/null 2>&1
    rm -rf "$DATA" "$LOG" && echo "cluster cancellato" ;;
  *)
    echo "uso: ./db/local.sh start|stop|status|destroy" >&2; exit 2 ;;
esac
