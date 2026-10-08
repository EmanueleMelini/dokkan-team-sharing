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
#
# Con next start (e su Vercel) un URL evento non prerenderizzato riceve alla
# prima visita lo shell dell'app con 200, e il 404 arriva nello stream (con
# noindex); la pagina rigenerata dietro e' un 404 vero, servito dalla cache
# dalla seconda visita. Per questo un 200 con noindex vale un secondo giro.
verifica_404 () { # nome percorso
  prendi "$2"
  if [ "$codice" = 200 ] && grep -q '<meta name="robots" content="noindex"' "$TMP/html"; then prendi "$2"; fi
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
# Le viste filtrate stanno in /events/browse: /events e' statica e non legge la query
verifica "seconda pagina" '/events/browse?page=2' 200 '(^| )61-[0-9]+ of [0-9]+ events' "$ERRORE"
verifica "pagina enorme: si torna alla prima, niente 500" '/events/browse?page=99999999999999999999' 200 \
  ' of [0-9]+ events' "$ERRORE"
verifica "versione giapponese" '/events/browse?region=japan' 200 ' of [0-9]+ events' "$ERRORE"
prendi '/events/browse?page=2'
grep -q '<meta name="robots" content="noindex, follow"' "$TMP/html" && pass "le viste filtrate sono noindex" \
  || fail "/events/browse senza noindex"

echo "la ricerca"
verifica "un NUL nella ricerca non rompe la query" '/events/browse?q=%00' 200 ' events?( |$)' "$ERRORE"
# Come per il %: da jolly troverebbe tutti gli eventi, su piu' pagine.
# Non si chiede "0 events", che smetterebbe di valere il giorno in cui un
# nome importato contiene davvero un _.
verifica "il _ cerca un _, non un carattere qualsiasi" '/events/browse?q=_' 200 '[0-9]+ events? ' "$ERRORE| of [0-9]+ events"
# con il % come jolly uscirebbero tutti, su piu' pagine ("1-60 of ...")
verifica "il % cerca un %" '/events/browse?q=%25' 200 '%' "$ERRORE| of [0-9]+ events"

echo "le pagine che non ci sono"
verifica_404 "id non numerico" /events/abc
verifica_404 "id che non esiste" /events/999999999999
verifica_404 "percorso sconosciuto" /percorso-che-non-esiste
# proxy.ts: senza il cookie di sessione ogni URL di /admin e' un 404 vero
echo "l'area admin, senza sessione"
verifica_404 "admin: la coda" /admin
verifica_404 "admin: i nascosti" /admin/hidden
verifica_404 "admin: un utente" /admin/users/qualcuno
verifica_404 "admin: il registro" /admin/log

# /cards/<id> (lib/card-page.ts): pubblica e in cache. La forma Z (base + 1)
# porta alla base con un 308; un id che non e' una carta e' un 404 vero.
echo "la pagina di una carta"
verifica "una carta" /cards/1032310 200 'Third Eye Gomah' "$ERRORE"
verifica "una carta senza artwork ne' testi (solo datamine)" /cards/1031350 200 'Artwork not available yet' "$ERRORE"
verifica_404 "carta: id non numerico" /cards/abc
verifica_404 "carta: id che non esiste" /cards/99999999
verifica_404 "carta: zeri iniziali" /cards/01032310
read -r codice dove < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --max-time 120 "$BASE/cards/1032311")
case "$codice $dove" in
  "308 "*/cards/1032310) pass "la forma Z porta alla base (308)" ;;
  *) fail "la forma Z: /cards/1032311 ha risposto $codice $dove, atteso 308 verso /cards/1032310" ;;
esac

echo "le pagine evento"
EZA=${SMOKE_EZA_ID:-$(primo_evento '/events/browse?type=zbattle' '[0-9]+ levels')}
STAGE=${SMOKE_STAGE_ID:-$(primo_evento '/events/browse?type=challenge' '[1-9][0-9]* stages?')}
if [ -z "$EZA" ]; then fail "nessuna EZA con livelli nella lista: mancano i dati importati?"
else verifica "un'EZA ($EZA) parla di livelli" "/events/$EZA" 200 '[0-9]+ levels' "$ERRORE|[0-9]+ stages? "
fi
if [ -z "$STAGE" ]; then fail "nessuna sfida con stage nella lista: mancano i dati importati?"
else verifica "una sfida ($STAGE) parla di stage" "/events/$STAGE" 200 '[0-9]+ stages?' "$ERRORE|[0-9]+ levels"
  # Le tip (0025): il blocco c'e', nella versione anonima (il form e' un'isola)
  if grep -q 'id="tips"' "$TMP/html" && grep -q 'Sign in to share a tip' "$TMP/testo"; then
    if grep -q 'Share a tip</button>' "$TMP/html"; then fail "la pagina in cache ha il bottone Share a tip"
    else pass "le tip nella pagina evento, versione anonima"; fi
  else fail "/events/$STAGE senza il blocco delle tip (id=\"tips\", Sign in to share a tip)"
  fi
  verifica "la versione giapponese nel percorso" "/events/$STAGE/japan" 200 'Japanese version' "$ERRORE"
fi

echo "gli URL delle viste (lib/urls.ts)"
if [ -n "$EZA" ]; then
  prendi "/events/$EZA"
  TIER=$(grep -oE "href=\"/events/$EZA/t/[0-9]+\"" "$TMP/html" | head -1 | grep -oE '[0-9]+"$' | tr -d '"')
  if [ -z "$TIER" ]; then fail "la pagina dell'EZA non ha link /t/<tier>"
  else
    verifica "un livello scelto" "/events/$EZA/t/$TIER" 200 '[0-9]+ levels' "$ERRORE"
    verifica_404 "un tier che non e' dell'evento" "/events/$EZA/t/999999999999"
    verifica_404 "p/1 non esiste (la pagina 1 e' senza /p)" "/events/$EZA/t/$TIER/p/1"
    verifica_404 "una pagina oltre l'ultima" "/events/$EZA/t/$TIER/p/99999"
  fi
  verifica_404 "un segmento sconosciuto" "/events/$EZA/zzz"
  verifica_404 "Japan con la maiuscola" "/events/$EZA/Japan"
fi
read -r codice dove < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --max-time 60 "$BASE/")
[ "$codice" = 307 ] && [ "$dove" = "$BASE/events" ] && pass "/ porta a /events (307)" || fail "/: $codice $dove"
prendi /robots.txt
grep -q 'Disallow: /events/browse' "$TMP/html" && pass "robots.txt esclude /events/browse" || fail "robots.txt senza /events/browse"
grep -q 'Disallow: /admin' "$TMP/html" && pass "robots.txt esclude /admin" || fail "robots.txt senza /admin"
prendi /sitemap.xml
grep -q '/cards/1032310</loc>' "$TMP/html" && pass "la sitemap ha le carte" || fail "la sitemap non ha /cards/1032310"
prendi /settings
[ "$codice" = 307 ] && pass "Settings senza sessione porta a /login (307)" || fail "/settings senza sessione ha risposto $codice, atteso 307"

echo "chi guarda (/api/me)"
intestazioni=$(curl -s -D - -o "$TMP/html" --max-time 60 "$BASE/api/me" | tr -d '\r')
[ "$(cat "$TMP/html")" = '{"user":null}' ] && grep -qi '^cache-control:.*no-store' <<<"$intestazioni" \
  && pass "/api/me senza cookie: {\"user\":null}, no-store" || fail "/api/me senza cookie: $(head -c 80 "$TMP/html")"
grep -qi '^access-control-allow-origin' <<<"$intestazioni" && fail "/api/me con un header CORS" \
  || pass "/api/me senza header CORS"
grep -qi '^vary:.*cookie' <<<"$intestazioni" && pass "/api/me con Vary: Cookie" || fail "/api/me senza Vary: Cookie"
# La pagina in cache e' la stessa per tutti: Report, il banner della
# sospensione e il link Moderation arrivano solo dalle isole client.
if [ -n "${STAGE:-}" ]; then
  prendi "/events/$STAGE"
  grep -qE 'Report(<span[^>]*>)? this (clear|comment|tip)|Your account is suspended|>Moderation<' "$TMP/html" \
    && fail "la pagina in cache contiene Report, il banner o il link Moderation" \
    || pass "la pagina in cache non ha niente di chi guarda (Report, sospensione, Moderation)"
fi

# Contro next start (non next dev): le pagine pubbliche escono dalla cache
if [ "${SMOKE_EXPECT_CACHE:-}" = 1 ]; then
  echo "la cache (next start)"
  for p in /events ${EZA:+/events/$EZA} /cards/1032310; do
    curl -s -o /dev/null "$BASE$p"
    stato=$(curl -s -D - -o /dev/null "$BASE$p" | tr -d '\r' | grep -i '^x-nextjs-cache:' | awk '{print $2}')
    [ "$stato" = HIT ] && pass "$p al secondo giro: HIT" || fail "$p al secondo giro: x-nextjs-cache ${stato:-assente}"
  done
fi

[ "$fails" -eq 0 ] && echo "TUTTO VERDE" || { echo "$fails verifiche rosse"; exit 1; }
