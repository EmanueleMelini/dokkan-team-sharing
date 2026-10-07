#!/usr/bin/env bash
# npm run test:smoke: una prova di fumo sul sito che gira gia'.
#
# Solo richieste GET: non scrive niente, quindi si puo' lanciare contro il
# server di sviluppo (che legge dokkan_dev) senza toccarne i dati. Non fa
# parte di db:test: quello prova le query, questo che le pagine rispondano
# con il codice giusto anche agli URL brutti, invece di un 500.
#
#   npm run test:smoke                              http://localhost:3000
#   SMOKE_URL=http://localhost:3001 npm run test:smoke
#
# Richiede i dati importati (piu' di una pagina di eventi, un'EZA, una
# sfida con stage), non i clear dimostrativi di db:demo. Gli eventi da
# aprire si prendono dalla lista; SMOKE_EZA_ID e SMOKE_STAGE_ID li fissano.
set -uo pipefail
BASE=${SMOKE_URL:-http://localhost:3000}
BASE=${BASE%/}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fails=0
pass () { printf '  PASS  %s\n' "$1"; }
fail () { printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }

# prendi percorso: il corpo in $TMP/html, il testo visibile in $TMP/testo,
# il codice HTTP in $codice. Il testo esclude gli <script>: il payload di
# React ripete tutta la pagina, compreso il 404 del layout, e farebbe
# trovare frasi che sullo schermo non ci sono.
prendi () {
  codice=$(curl -s -o "$TMP/html" -w '%{http_code}' --max-time 120 "$BASE$1") || codice=000
  perl -0pe 's/<script\b.*?<\/script>//gs; s/<!-- -->//g; s/<[^>]*>/ /g; s/&#x27;/\x27/g; s/&amp;/&/g; s/\s+/ /g' \
    "$TMP/html" > "$TMP/testo" 2>/dev/null || : > "$TMP/testo"
}

# verifica nome percorso codice-atteso [regex-che-deve-esserci] [regex-che-non-deve-esserci]
verifica () {
  local nome=$1 percorso=$2 atteso=$3 si=${4:-} no=${5:-}
  prendi "$percorso"
  if [ "$codice" != "$atteso" ]; then fail "$nome: $percorso ha risposto $codice, atteso $atteso"; return; fi
  if [ -n "$si" ] && ! grep -qE -- "$si" "$TMP/testo"; then fail "$nome: $percorso non contiene /$si/"; return; fi
  if [ -n "$no" ] && grep -qE -- "$no" "$TMP/testo"; then fail "$nome: $percorso contiene /$no/"; return; fi
  pass "$nome ($codice)"
}

# Una pagina che non c'e'. Il testo del 404 non si puo' cercare: con
# notFound() dentro una pagina il corpo arriva nel payload di React, che
# pero' contiene quel testo su OGNI pagina (e' il confine not-found del
# layout). Next marca la risposta con noindex, e solo quella: basta quello,
# insieme al codice.
verifica_404 () { # nome percorso
  prendi "$2"
  if [ "$codice" != 404 ]; then fail "$1: $2 ha risposto $codice, atteso 404"; return; fi
  if ! grep -q '<meta name="robots" content="noindex"' "$TMP/html"; then fail "$1: $2 senza noindex"; return; fi
  if grep -qE -- "$ERRORE" "$TMP/testo"; then fail "$1: $2 mostra l'errore"; return; fi
  pass "$1 ($codice)"
}

# il primo evento della lista il cui riquadro dice /regex/
primo_evento () { # percorso-lista regex
  prendi "$1"
  perl -0ne 's/<script\b.*?<\/script>//gs; s/<!-- -->//g;
    while (/<li>(.*?)<\/li>/gs) { my $x = $1;
      next unless $x =~ m{href="/events/(\d+)"}; my $id = $1;
      $x =~ s/<[^>]*>/ /g; print "$id\n" if $x =~ /'"$2"'/ }' "$TMP/html" | head -1
}

echo "  sito: $BASE"
prendi /events
if [ "$codice" = 000 ]; then
  echo "  il sito non risponde su $BASE: avvialo con  npm run dev,  o indica SMOKE_URL" >&2
  exit 2
fi

ERRORE='Something went wrong'

echo "la lista degli eventi"
verifica "prima pagina" /events 200 '(^| )1-60 of [0-9]+ events' "$ERRORE"
verifica "seconda pagina" '/events?page=2' 200 '(^| )61-[0-9]+ of [0-9]+ events' "$ERRORE"
verifica "pagina enorme: si torna alla prima, niente 500" '/events?page=99999999999999999999' 200 \
  ' of [0-9]+ events' "$ERRORE"
verifica "versione giapponese" '/events?region=japan' 200 ' of [0-9]+ events' "$ERRORE"

echo "la ricerca"
verifica "un NUL nella ricerca non rompe la query" '/events?q=%00' 200 ' events?( |$)' "$ERRORE"
# Come per il %: da jolly troverebbe tutti gli eventi, su piu' pagine.
# Non si chiede "0 events", che smetterebbe di valere il giorno in cui un
# nome importato contiene davvero un _.
verifica "il _ cerca un _, non un carattere qualsiasi" '/events?q=_' 200 '[0-9]+ events? ' "$ERRORE| of [0-9]+ events"
# con il % come jolly uscirebbero tutti, su piu' pagine ("1-60 of ...")
verifica "il % cerca un %" '/events?q=%25' 200 '%' "$ERRORE| of [0-9]+ events"

echo "le pagine che non ci sono"
verifica_404 "id non numerico" /events/abc
verifica_404 "id che non esiste" /events/999999999999
verifica_404 "percorso sconosciuto" /percorso-che-non-esiste

echo "le pagine evento"
EZA=${SMOKE_EZA_ID:-$(primo_evento '/events?type=zbattle' '[0-9]+ levels')}
STAGE=${SMOKE_STAGE_ID:-$(primo_evento '/events?type=challenge' '[1-9][0-9]* stages?')}
if [ -z "$EZA" ]; then fail "nessuna EZA con livelli nella lista: mancano i dati importati?"
else verifica "un'EZA ($EZA) parla di livelli" "/events/$EZA" 200 '[0-9]+ levels' "$ERRORE|[0-9]+ stages? "
fi
if [ -z "$STAGE" ]; then fail "nessuna sfida con stage nella lista: mancano i dati importati?"
else verifica "una sfida ($STAGE) parla di stage" "/events/$STAGE" 200 '[0-9]+ stages?' "$ERRORE|[0-9]+ levels"
fi

[ "$fails" -eq 0 ] && echo "TUTTO VERDE" || { echo "$fails verifiche rosse"; exit 1; }
