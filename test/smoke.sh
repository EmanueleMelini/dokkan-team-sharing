#!/usr/bin/env bash
# npm run test:smoke: una prova di fumo sul sito che gira gia'.
#
# Solo richieste GET (piu' una POST di disiscrizione con un token falso, che
# si ferma prima del database): non scrive niente, quindi si puo' lanciare contro il
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
# Il profilo da aprire si cerca nelle pagine evento; SMOKE_PROFILE_HANDLE
# lo fissa (con db:demo: demo_rotation).
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
#
# Una pagina dinamica (per utente o con la query string) non va mai in
# cache: con next start ogni visita riceve lo shell con 200 e il 404 nello
# stream. Il terzo argomento "dinamica" lo accetta, ma solo contro next
# start (SMOKE_EXPECT_CACHE=1); con next dev resta un 404 vero.
verifica_404 () { # nome percorso [dinamica]
  prendi "$2"
  if [ "$codice" = 200 ] && grep -q '<meta name="robots" content="noindex"' "$TMP/html"; then
    if [ "${3:-}" = dinamica ] && [ "${SMOKE_EXPECT_CACHE:-}" = 1 ]; then pass "$1 (200, 404 nello stream: next start)"; return; fi
    prendi "$2"
  fi
  if [ "$codice" != 404 ]; then fail "$1: $2 ha risposto $codice, atteso 404"; return; fi
  if ! grep -q '<meta name="robots" content="noindex"' "$TMP/html"; then fail "$1: $2 senza noindex"; return; fi
  if grep -qE -- "$ERRORE" "$TMP/testo"; then fail "$1: $2 mostra l'errore"; return; fi
  pass "$1 ($codice)"
}

# Un redirect vero: il codice e la Location. Con next start
# (SMOKE_EXPECT_CACHE=1) il redirect di una pagina non prerenderizzata
# arriva nello stream (200), e quello servito dalla cache e' un 308 senza
# Location: li' vale il NEXT_REDIRECT nel corpo, che il browser segue. La
# prima visita a un URL mai visto puo' essere lo shell senza il redirect,
# che la pagina rigenerata dietro avra': un 200 vale un secondo giro.
rimanda () { # nome percorso codice destinazione
  local nome=$1 percorso=$2 atteso=$3 dest=$4 c d
  read -r c d < <(curl -s -o "$TMP/html" -w '%{http_code} %{redirect_url}\n' --max-time 120 "$BASE$percorso") || c=000
  if [ "$c" = 200 ] && [ "${SMOKE_EXPECT_CACHE:-}" = 1 ] && ! grep -qF "NEXT_REDIRECT;" "$TMP/html"; then
    read -r c d < <(curl -s -o "$TMP/html" -w '%{http_code} %{redirect_url}\n' --max-time 120 "$BASE$percorso") || c=000
  fi
  if [ "$c" = "$atteso" ] && [[ "$d" == *"$dest" ]]; then pass "$nome ($c)"; return; fi
  if [ "${SMOKE_EXPECT_CACHE:-}" = 1 ] && grep -qF "NEXT_REDIRECT;replace;$dest;$atteso;" "$TMP/html"; then
    pass "$nome ($c, redirect nel corpo: next start)"; return
  fi
  fail "$nome: $percorso ha risposto $c $d, atteso $atteso verso $dest"
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
rimanda "la forma Z porta alla base" /cards/1032311 308 /cards/1032310

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
    # La lista filtrata (lib/clears/filtri.ts): dinamica, noindex con il
    # canonical al tier senza filtri; un valore sbagliato vale "non
    # impostato", mai un 500.
    echo "la lista filtrata dei clear"
    verifica "filtri: la lista filtrata" "/events/$EZA/clears?tier=$TIER&proof=1" 200 '[0-9]+ levels' "$ERRORE"
    grep -q '<meta name="robots" content="noindex, follow"' "$TMP/html" && pass "la lista filtrata e' noindex" \
      || fail "/events/$EZA/clears senza noindex"
    grep -q "<link rel=\"canonical\" href=\"[^\"]*/events/$EZA/t/$TIER\"" "$TMP/html" && pass "la lista filtrata ha il canonical al tier" \
      || fail "/events/$EZA/clears senza canonical a /events/$EZA/t/$TIER"
    verifica "filtri: valori sbagliati, niente 500" \
      "/events/$EZA/clears?tier=$TIER&proof=1&card=abc&turns=999&sort=zzz&cat=99999&mono=teq&leader=1%27" 200 '[0-9]+ levels' "$ERRORE"
    verifica_404 "filtri: un tier che non e' un id" "/events/$EZA/clears?tier=abc" dinamica
    prendi "/events/$EZA/t/$TIER"
    grep -q '<meta name="robots" content="noindex' "$TMP/html" && fail "la pagina statica del tier e' noindex" \
      || pass "la pagina del tier senza filtri resta indicizzabile"
  fi
  verifica_404 "un segmento sconosciuto" "/events/$EZA/zzz"
  verifica_404 "Japan con la maiuscola" "/events/$EZA/Japan"
fi
read -r codice dove < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --max-time 60 "$BASE/")
[ "$codice" = 307 ] && [ "$dove" = "$BASE/events" ] && pass "/ porta a /events (307)" || fail "/: $codice $dove"
prendi /robots.txt
grep -q 'Disallow: /events/browse' "$TMP/html" && pass "robots.txt esclude /events/browse" || fail "robots.txt senza /events/browse"
grep -q 'Disallow: /admin' "$TMP/html" && pass "robots.txt esclude /admin" || fail "robots.txt senza /admin"
grep -qx 'Disallow: /events/\*/clears' "$TMP/html" && pass "robots.txt esclude /events/*/clears" || fail "robots.txt senza /events/*/clears"
grep -qx 'Disallow: /notifications' "$TMP/html" && pass "robots.txt esclude /notifications" || fail "robots.txt senza /notifications"
prendi /sitemap.xml
grep -q '/cards/1032310</loc>' "$TMP/html" && pass "la sitemap ha le carte" || fail "la sitemap non ha /cards/1032310"
rimanda "Settings senza sessione porta a /login" /settings 307 '/login?next=%2Fsettings'
# Le notifiche (0028) sono per utente: la lista e la rotta di un link.
# La rotta e' un Route Handler, quindi il 307 e' vero anche con next start.
rimanda "Notifications senza sessione porta a /login" /notifications 307 '/login?next=%2Fnotifications'
rimanda "il link di una notifica senza sessione porta a /login e poi li'" /notifications/123 307 \
  '/login?next=%2Fnotifications%2F123'

# Il digest email (0029). La pagina di disiscrizione non legge la sessione:
# senza token o con un token falso dice che il link non vale, con noindex e
# no-referrer. Il one-click accetta solo POST: un GET va alla pagina con un
# 303, e una POST con un token falso e' un 400 che non scrive niente (la
# firma si controlla prima del database). Il cron senza segreto e' un 401.
echo "digest email (disiscrizione e cron)"
verifica "la disiscrizione senza token" /notifications/unsubscribe 200 'unsubscribe link is not valid'
verifica "la disiscrizione con un token falso" '/notifications/unsubscribe?t=v1.falso' 200 'unsubscribe link is not valid'
intestazioni=$(curl -s -D - -o "$TMP/html" --max-time 60 "$BASE/notifications/unsubscribe" | tr -d '\r')
grep -qi '^referrer-policy: no-referrer$' <<<"$intestazioni" && grep -q 'name="robots" content="noindex' "$TMP/html" \
  && pass "la disiscrizione: Referrer-Policy no-referrer e noindex" || fail "la disiscrizione senza no-referrer o noindex"
read -r codice dove < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --max-time 60 "$BASE/api/notifications/unsubscribe?t=abc")
[ "$codice" = 303 ] && [ "$dove" = "$BASE/notifications/unsubscribe?t=abc" ] \
  && pass "il one-click con un GET porta alla pagina (303)" || fail "GET del one-click: $codice $dove"
intestazioni=$(curl -s -D - -o "$TMP/html" --max-time 60 -X POST -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'List-Unsubscribe=One-Click' "$BASE/api/notifications/unsubscribe?t=v1.falso" | tr -d '\r')
grep -q '^HTTP/[0-9.]* 400' <<<"$intestazioni" && ! grep -qi '^set-cookie' <<<"$intestazioni" \
  && pass "il one-click con un token falso: 400, nessun cookie" || fail "POST del one-click: $(head -1 <<<"$intestazioni")"
codice=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 "$BASE/api/cron/digest") || codice=000
if [ "$codice" = 401 ]; then pass "il cron del digest senza segreto: 401"; else fail "/api/cron/digest senza segreto: $codice"; fi

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
# Il pallino delle notifiche arriva solo da /api/me: mai nell'HTML del server.
for pagina in /events ${STAGE:+/events/$STAGE}; do
  prendi "$pagina"
  grep -qE 'aria-label="Notifications|data-pallino' "$TMP/html" \
    && fail "$pagina contiene la campanella o il pallino delle notifiche" \
    || pass "$pagina senza campanella ne' pallino nell'HTML del server"
done

# /users/<handle> (lib/profiles.ts): pubblico e in cache. Le maiuscole
# diverse portano all'handle salvato con un 308; un handle che non c'e',
# malformato o riservato e' un 404 vero. L'handle si prende da un clear di
# una pagina evento, o da SMOKE_PROFILE_HANDLE (con db:demo: demo_rotation).
echo "il profilo pubblico"
UTENTE=${SMOKE_PROFILE_HANDLE:-}
for p in ${STAGE:+/events/$STAGE} ${EZA:+/events/$EZA} ${TIER:+/events/$EZA/t/$TIER}; do
  [ -n "$UTENTE" ] && break
  prendi "$p"
  UTENTE=$(grep -o 'href="/users/[A-Za-z0-9_]*"' "$TMP/html" | head -1 | sed 's#href="/users/##; s#"$##')
done
if [ -n "$UTENTE" ]; then
  verifica "un profilo ($UTENTE)" "/users/$UTENTE" 200 "Joined [A-Z][a-z]+ [0-9]{4}" "$ERRORE"
  grep -q '>Edit profile<' "$TMP/html" && fail "il profilo in cache contiene Edit profile" || pass "il profilo in cache non ha Edit profile"
  ALTO=$(printf '%s' "$UTENTE" | tr '[:lower:]' '[:upper:]')
  # Contro next start si salta: la cache ISR locale sta su file, e su un
  # disco che non distingue le maiuscole (APFS di macOS) il 308 di
  # /users/DEMO prenderebbe il posto della voce di /users/demo, che poi
  # risponderebbe con un redirect a se stessa. Su Vercel la cache distingue.
  if [ "$ALTO" != "$UTENTE" ] && [ "${SMOKE_EXPECT_CACHE:-}" != 1 ]; then
    rimanda "le maiuscole diverse portano all'handle salvato" "/users/$ALTO" 308 "/users/$UTENTE"
  elif [ "$ALTO" != "$UTENTE" ]; then
    echo "  (next start: salto il 308 delle maiuscole, la cache su file locale non le distingue)"
  fi
  verifica_404 "profilo: pagina 1 esplicita" "/users/$UTENTE/p/1"
else
  echo "  (nessun handle nelle pagine evento: salto le verifiche positive del profilo)"
fi
verifica_404 "profilo: handle che non c'e'" /users/nessuno_xyz_404
verifica_404 "profilo: handle malformato" /users/a-b
verifica_404 "profilo: nome riservato" /users/users

# La PWA (fase 1): manifest, icone con la misura vera (dall'IHDR), il
# service worker senza cache lunga e la pagina offline. L'invito a
# installare e' un'isola: nell'HTML del server non c'e'.
echo "la PWA"
intestazioni=$(curl -s -D - -o "$TMP/manifest" --max-time 60 "$BASE/manifest.webmanifest" | tr -d '\r')
if grep -qiE '^HTTP/[0-9.]+ 200' <<<"$intestazioni" && grep -qi '^content-type: application/manifest+json' <<<"$intestazioni"; then
  pass "/manifest.webmanifest (200, application/manifest+json)"
else fail "/manifest.webmanifest: $(head -1 <<<"$intestazioni"), $(grep -i '^content-type' <<<"$intestazioni")"
fi
campi=$(node -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const png = (m.icons || []).filter((i) => i.type === "image/png").map((i) => i.purpose + " " + i.sizes).sort().join(",")
  console.log([m.id, m.short_name, m.start_url, m.scope, m.display, png].join("|"))
  for (const i of m.icons || []) if (i.type === "image/png") console.error(i.src + " " + i.sizes)
' "$TMP/manifest" 2>"$TMP/icone") || campi=''
[ "$campi" = '/|dokkants|/events|/|standalone|any 192x192,any 512x512,maskable 192x192,maskable 512x512' ] \
  && pass "manifest: id, short_name, start_url, scope, display, icone" || fail "manifest: $campi"
while read -r src misura; do
  codice=$(curl -s -o "$TMP/icona" -w '%{http_code} %{content_type}' --max-time 60 "$BASE$src")
  vera=$(node -e 'const b = require("fs").readFileSync(process.argv[1]); console.log(b.readUInt32BE(16) + "x" + b.readUInt32BE(20))' "$TMP/icona" 2>/dev/null)
  [ "$codice" = '200 image/png' ] && [ "$vera" = "$misura" ] && pass "$src ($misura)" || fail "$src: $codice, $vera invece di $misura"
done < "$TMP/icone"
intestazioni=$(curl -s -D - -o /dev/null --max-time 60 "$BASE/sw.js" | tr -d '\r')
grep -qiE '^HTTP/[0-9.]+ 200' <<<"$intestazioni" && grep -qiE '^content-type: (application|text)/javascript' <<<"$intestazioni" \
  && grep -qiE '^cache-control:.*max-age=0' <<<"$intestazioni" \
  && pass "/sw.js (200, javascript, max-age=0)" || fail "/sw.js: $(head -1 <<<"$intestazioni"), $(grep -iE '^(content-type|cache-control)' <<<"$intestazioni" | tr '\n' ' ')"
# Le push (fase 4): il worker servito ha i due gestori, e il badge c'e'.
curl -s -o "$TMP/sw" --max-time 60 "$BASE/sw.js"
grep -qF "addEventListener('push'" "$TMP/sw" && grep -qF "addEventListener('notificationclick'" "$TMP/sw" \
  && pass "/sw.js con i gestori push e notificationclick" || fail "/sw.js senza i gestori delle push"
codice=$(curl -s -o "$TMP/icona" -w '%{http_code} %{content_type}' --max-time 60 "$BASE/pwa/badge-96.png")
vera=$(node -e 'const b = require("fs").readFileSync(process.argv[1]); console.log(b.readUInt32BE(16) + "x" + b.readUInt32BE(20))' "$TMP/icona" 2>/dev/null)
[ "$codice" = '200 image/png' ] && [ "$vera" = 96x96 ] && pass "/pwa/badge-96.png (96x96)" || fail "/pwa/badge-96.png: $codice, $vera"
intestazioni=$(curl -s -D - -o "$TMP/html" --max-time 60 "$BASE/offline.html" | tr -d '\r')
grep -qiE '^HTTP/[0-9.]+ 200' <<<"$intestazioni" && grep -qi '^content-type: text/html' <<<"$intestazioni" \
  && grep -qi '^x-robots-tag: noindex' <<<"$intestazioni" && grep -qF "You're offline" "$TMP/html" \
  && pass "/offline.html (200, html, noindex)" || fail "/offline.html: $(head -1 <<<"$intestazioni")"
prendi /events
grep -q '<link rel="manifest" href="/manifest.webmanifest"' "$TMP/html" && grep -q 'name="apple-mobile-web-app-title" content="dokkants"' "$TMP/html" \
  && pass "/events con il manifest e il titolo per iOS" || fail "/events senza rel=manifest o apple-mobile-web-app-title"
grep -qE 'Install dokkants|Add to Home Screen' "$TMP/testo" && fail "l'invito a installare e' nell'HTML del server" \
  || pass "l'invito a installare non e' nell'HTML del server"

# Contro next start o Vercel (non next dev): le pagine pubbliche escono
# dalla cache. next start scrive x-nextjs-cache, Vercel x-vercel-cache (HIT,
# STALE o PRERENDER vengono tutti dalla cache).
if [ "${SMOKE_EXPECT_CACHE:-}" = 1 ]; then
  echo "la cache (next start o Vercel)"
  for p in /events ${EZA:+/events/$EZA} /cards/1032310 ${UTENTE:+/users/$UTENTE}; do
    curl -s -o /dev/null "$BASE$p"
    stato=$(curl -s -D - -o /dev/null "$BASE$p" | tr -d '\r' | grep -iE '^x-(nextjs|vercel)-cache:' | awk '{print $2}' | head -1)
    case "$stato" in
      HIT|STALE|PRERENDER) pass "$p al secondo giro: $stato" ;;
      *) fail "$p al secondo giro: cache ${stato:-assente}" ;;
    esac
  done
fi

[ "$fails" -eq 0 ] && echo "TUTTO VERDE" || { echo "$fails verifiche rosse"; exit 1; }
