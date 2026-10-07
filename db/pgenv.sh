# Sorgente comune per gli script shell del database.
#
# Per difetto si punta al Postgres.app in ascolto su 5432, quello che hai
# gia' e che vedi in DataGrip. Il cluster isolato di db/local.sh resta
# disponibile per chi non ha un Postgres proprio: basta esportare
# PGPORT=55432 PGUSER=dokkan.
# Il psql di Homebrew su questa macchina e' rotto (icu4c disallineato),
# quindi si preferisce quello di Postgres.app quando c'e'.
for c in /Applications/Postgres.app/Contents/Versions/latest/bin \
         /Applications/Postgres.app/Contents/Versions/15/bin; do
  [ -x "$c/psql" ] && export PATH="$c:$PATH" && break
done
command -v psql >/dev/null || { echo "psql non trovato" >&2; exit 1; }

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=emanuelemelini}"
: "${PGDATABASE:=dokkan_dev}"
export PGHOST PGPORT PGUSER PGDATABASE
