#!/usr/bin/env bash
# test/cpu.sh: quanta CPU costa una richiesta, per tipo di pagina, su un
# `next start` locale. Solo GET: non scrive niente.
#
#   npm run build && NODE_ENV=production NEXT_PRIVATE_DEBUG_CACHE=1 \
#     npx next start -p 3100 > /tmp/next.log 2>&1 &
#   CPU_URL=http://localhost:3100 CPU_LOG=/tmp/next.log test/cpu.sh
#
# Perche' cosi': su Vercel Hobby il limite e' la CPU attiva delle funzioni
# (4 ore al mese). In locale ogni richiesta passa comunque da Node, anche
# quella servita da un prerender (circa 1 ms); su Vercel la stessa
# risposta esce dalla CDN e costa zero. Le righe del log di debug della
# cache (dati rifatti, pagine rigenerate) stanno al posto delle invocazioni.
#
# Funziona sia con gli URL vecchi (?tier=, /events?type=) sia con quelli
# nuovi (/t/<tier>, /events/browse): li riconosce dalla pagina. Le classi
# carte, filtri e profili (dalla fase 4) restano vuote dove le pagine non
# ci sono; CPU_PROFILE_HANDLE=<handle> aggiunge un profilo da misurare.
set -uo pipefail
BASE=${CPU_URL:-http://localhost:3100}
BASE=${BASE%/}
N=${CPU_N:-200}
LOG=${CPU_LOG:-}
PORTA=${BASE##*:}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PID=${CPU_PID:-$(lsof -ti "tcp:$PORTA" -sTCP:LISTEN | head -1)}
[ -n "$PID" ] || { echo "  nessun server in ascolto su $PORTA" >&2; exit 2; }

# I secondi di CPU del server e dei suoi figli. ps su macOS scrive
# [[hh:]mm:]ss.cc: si somma tutto in millisecondi.
cpu_ms () {
  local pids tot=0 t
  pids="$PID $(pgrep -P "$PID" | tr '\n' ' ')"
  for p in $pids; do
    t=$(ps -o cputime= -p "$p" 2>/dev/null | tr -d ' ') || continue
    [ -n "$t" ] || continue
    tot=$((tot + $(echo "$t" | awk -F: '{s=0; for(i=1;i<=NF;i++) s=s*60+$i; printf "%d", s*1000}')))
  done
  echo "$tot"
}

# Dal log di NEXT_PRIVATE_DEBUG_CACHE=1: "leader resolved with generated
# entry" e' un 'use cache' rifatto (una query vera); "FileSystemCache: set"
# e' una pagina rigenerata e salvata (ISR), che su Vercel e' un'invocazione.
conta () { # regex
  [ -n "$LOG" ] && [ -f "$LOG" ] || { echo 0; return; }
  grep -cE "$1" "$LOG" || true
}
righe_miss () { conta 'use-cache: leader resolved with generated entry'; }
righe_isr () { conta 'FileSystemCache: set'; }

prendi () { curl -s -o "$TMP/html" -w '%{http_code}' --max-time 120 "$BASE$1" || echo 000; }

# Gli URL di prova -------------------------------------------------------
prendi /sitemap.xml > /dev/null
ids=$(grep -oE '/events/[0-9]+</loc>' "$TMP/html" | grep -oE '[0-9]+' | head -20)
[ -n "$ids" ] || { echo "  la sitemap non ha eventi" >&2; exit 2; }

nuovo=0
[ "$(prendi /events/browse?type=zbattle)" = 200 ] && nuovo=1
if [ "$nuovo" = 1 ]; then browse='/events/browse?type=zbattle'; else browse='/events?type=zbattle'; fi

: > "$TMP/eventi"; : > "$TMP/tier"
for id in $ids; do
  echo "/events/$id" >> "$TMP/eventi"
  prendi "/events/$id" > /dev/null
  # il primo link a un tier diverso da quello di apertura
  if [ "$nuovo" = 1 ]; then
    grep -oE "href=\"/events/$id/t/[0-9]+\"" "$TMP/html" | sed -E 's/href="([^"]+)"/\1/' | sed -n 2p >> "$TMP/tier"
  else
    grep -oE "href=\"/events/$id\?tier=[0-9]+\"" "$TMP/html" | sed -E 's/href="([^"]+)"/\1/' | sed -n 2p >> "$TMP/tier"
  fi
done
echo "/events" > "$TMP/lista"
echo "$browse" > "$TMP/browse"
echo "/api/cards?q=goku" > "$TMP/api"
# Dalla fase 4: le carte (dalla sitemap), le liste filtrate dei clear
# (dinamiche per scelta, una invocazione per vista) e i profili. Gli handle
# si prendono dalle pagine dei tier; CPU_PROFILE_HANDLE ne aggiunge uno.
prendi /sitemap.xml > /dev/null
grep -oE '/cards/[0-9]+</loc>' "$TMP/html" | sed 's#</loc>##' | head -20 > "$TMP/carte"
: > "$TMP/filtri"; : > "$TMP/profili"
if [ "$nuovo" = 1 ]; then
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    id=${t#/events/}; id=${id%%/*}
    echo "/events/$id/clears?tier=${t##*/}&proof=1" >> "$TMP/filtri"
    prendi "$t" > /dev/null
    grep -oE 'href="/users/[A-Za-z0-9_]+"' "$TMP/html" | sed -E 's/href="([^"]+)"/\1/' >> "$TMP/profili"
  done < "$TMP/tier"
fi
[ -n "${CPU_PROFILE_HANDLE:-}" ] && echo "/users/$CPU_PROFILE_HANDLE" >> "$TMP/profili"
sort -u -o "$TMP/profili" "$TMP/profili"

printf '  server %s (pid %s), schema URL %s, %s richieste per classe\n\n' \
  "$BASE" "$PID" "$([ $nuovo = 1 ] && echo nuovo || echo vecchio)" "$N"
printf '  %-8s %6s %10s %8s %6s  %s\n' classe url 'ms CPU/req' 'dati MISS' 'ISR' 'header al 2o giro'

for classe in lista eventi tier browse api carte filtri profili; do
  urls=()
  while IFS= read -r u; do [ -n "$u" ] && urls+=("$u"); done < "$TMP/$classe"
  [ ${#urls[@]} -gt 0 ] || { printf '  %-8s nessun URL\n' "$classe"; continue; }
  # riscaldamento: il primo giro compila e riempie le cache
  for u in "${urls[@]}"; do prendi "$u" > /dev/null; done
  intestazioni=$(curl -s -D - -o /dev/null "$BASE${urls[0]}" \
    | grep -iE '^(x-nextjs-cache|x-nextjs-prerender|cache-control):' | tr -d '\r' | tr '\n' ' ')
  m0=$(righe_miss); i0=$(righe_isr); c0=$(cpu_ms)
  for ((i = 0; i < N; i++)); do
    curl -s -o /dev/null --max-time 120 "$BASE${urls[$((i % ${#urls[@]}))]}"
  done
  c1=$(cpu_ms); m1=$(righe_miss); i1=$(righe_isr)
  printf '  %-8s %6s %10s %8s %6s  %s\n' "$classe" "${#urls[@]}" \
    "$(awk -v a="$c0" -v b="$c1" -v n="$N" 'BEGIN { printf "%.2f", (b - a) / n }')" \
    "$((m1 - m0))" "$((i1 - i0))" "$intestazioni"
done
