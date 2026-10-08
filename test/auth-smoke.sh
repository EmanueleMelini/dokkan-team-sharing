#!/usr/bin/env bash
# npm run test:auth-smoke: il giro del magic link sul server di sviluppo
# che gira gia', con un indirizzo finto (smoke+<ora>@example.invalid).
#
#   richiesta del link -> link letto dal file di sviluppo -> verifica ->
#   cookie di sessione e indizio dts_signed_in -> /api/me -> nessun handle
#   nell'HTML in cache di un evento -> /welcome -> /settings rimanda a /welcome ->
#   lo stesso link una seconda volta non vale -> uscita -> sessione morta
#
# Solo in sviluppo: il link si legge da $TMPDIR/dokkan-magic-links.log, che
# il server scrive solo senza RESEND_API_KEY e mai in produzione. Alla fine
# cancella l'utente di prova (e le sue sessioni, a cascata) da dokkan_dev.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE=${SMOKE_URL:-http://localhost:3000}
BASE=${BASE%/}
LOG=${MAGIC_LINK_LOG:-$(node -p "require('path').join(require('os').tmpdir(), 'dokkan-magic-links.log')")}
EMAIL="smoke+$(date +%s)@example.invalid"
TMP=$(mktemp -d)
JAR="$TMP/jar"

fails=0
pass () { printf '  PASS  %s\n' "$1"; }
fail () { printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }

pulisci () {
  # L'utente di prova esce in ogni caso, anche se una verifica e' fallita.
  node --input-type=module -e "
    import pg from 'pg'; import { connectionString } from './db/env.mjs'
    const c = new pg.Client({ connectionString: connectionString() }); await c.connect()
    const r = await c.query(\"delete from app_user where email = \$1 and email like 'smoke+%@example.invalid'\", [process.argv[1]])
    await c.query('delete from auth_email_send where email = \$1', [process.argv[1]])
    console.log('  pulizia: ' + r.rowCount + ' utente di prova cancellato')
    await c.end()" "$EMAIL"
  rm -rf "$TMP"
}
trap pulisci EXIT

# chiedi percorso [curl args...]: codice in $codice, Location in $dove
chiedi () {
  local p=$1; shift
  read -r codice dove < <(curl -s -o "$TMP/body" -w '%{http_code} %{redirect_url}\n' \
    -b "$JAR" -c "$JAR" --max-time 120 "$@" "$BASE$p") || codice=000
}

manda_link () {
  chiedi /api/auth/sign-in/magic-link -X POST -H 'content-type: application/json' \
    -H "origin: $BASE" --data "{\"email\":\"$EMAIL\",\"callbackURL\":\"/welcome?next=/events\"}"
}

manda_link
[ "$codice" = 200 ] && pass "richiesta del link: 200" || fail "richiesta del link: $codice"

link=$(grep -F " $EMAIL " "$LOG" 2>/dev/null | tail -1 | awk '{print $3}')
[ -n "$link" ] && pass "il link e' nel file di sviluppo" || { fail "nessun link per $EMAIL in $LOG"; exit 1; }
case $link in
  "$BASE"/api/auth/magic-link/verify\?token=*) pass "il link punta a /api/auth/magic-link/verify" ;;
  *) fail "link inatteso: ${link%%\?*}" ;;
esac

# La pausa per email: un secondo invio subito risponde uguale ma non parte.
manda_link
dopo=$(grep -cF " $EMAIL " "$LOG")
[ "$codice" = 200 ] && [ "$dopo" = 1 ] && pass "secondo invio entro 60 s: 200 e nessun link nuovo" \
  || fail "secondo invio: codice $codice, link per l'indirizzo $dopo (attesi 200 e 1)"

# Un altro origin non puo' chiedere link a nome del sito.
chiedi /api/auth/sign-in/magic-link -X POST -H 'content-type: application/json' \
  -H 'origin: https://evil.example' --data "{\"email\":\"$EMAIL\"}"
[ "$codice" = 403 ] && pass "origin estraneo: 403" || fail "origin estraneo: $codice, atteso 403"

chiedi "${link#"$BASE"}"
case "$codice $dove" in
  "302 $BASE/welcome?next=/events"|"302 $BASE/welcome?next=%2Fevents") pass "verifica: 302 a /welcome" ;;
  *) fail "verifica: $codice $dove" ;;
esac
grep -q 'dts.session_token' "$JAR" && pass "cookie di sessione impostato" || fail "nessun cookie di sessione"

chiedi /api/auth/get-session
grep -q '"onboardedAt":null' "$TMP/body" && pass "sessione: utente nuovo, non ancora completo" \
  || fail "get-session non dice onboardedAt null"

# L'indizio per le pagine in cache, e chi guarda solo da /api/me
grep -qE 'dts_signed_in[[:space:]]+1' "$JAR" && pass "indizio dts_signed_in impostato" || fail "nessun indizio dts_signed_in"
handle=$(grep -oE '"handle":"[^"]+"' "$TMP/body" | head -1 | cut -d'"' -f4)
chiedi /api/me
grep -qF "\"handle\":\"$handle\"" "$TMP/body" && pass "/api/me con la sessione: l'utente" || fail "/api/me non dice l'utente"
# La privacy della cache: la pagina di un evento e' la stessa per tutti, e
# l'HTML che riceve chi e' dentro non contiene niente di suo.
evento=$(curl -s --max-time 120 "$BASE/sitemap.xml" | grep -oE '/events/[0-9]+</loc>' | head -1 | grep -oE '[0-9]+')
if [ -n "$evento" ] && [ -n "$handle" ]; then
  chiedi "/events/$evento"
  [ "$codice" = 200 ] && ! grep -qF "$handle" "$TMP/body" && pass "l'HTML di /events/$evento non contiene l'handle" \
    || fail "/events/$evento: $codice, o l'HTML contiene l'handle"
else
  fail "nessun evento nella sitemap o nessun handle per la prova di privacy"
fi

chiedi '/welcome?next=/events'
[ "$codice" = 200 ] && grep -q 'Welcome' "$TMP/body" && pass "/welcome: 200 con il form" || fail "/welcome: $codice"
chiedi /settings
[ "$codice" = 307 ] && [[ $dove == "$BASE/welcome"* ]] && pass "/settings prima di /welcome: 307 a /welcome" \
  || fail "/settings: $codice $dove"

# Monouso: lo stesso link, con un'altra sessione (nessun cookie), non vale.
read -r codice dove < <(curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --max-time 60 "$link")
[[ $codice == 302 && $dove == *error=INVALID_TOKEN* ]] && pass "il link usato una seconda volta: INVALID_TOKEN" \
  || fail "secondo uso del link: $codice $dove"

chiedi /api/auth/sign-out -X POST -H "origin: $BASE" -H 'content-type: application/json' --data '{}'
[ "$codice" = 200 ] && pass "uscita: 200" || fail "uscita: $codice"
chiedi /api/auth/get-session
[ "$(cat "$TMP/body")" = null ] && pass "dopo l'uscita la sessione non c'e' piu'" || fail "sessione ancora viva dopo l'uscita"
grep -qE 'dts_signed_in[[:space:]]+1' "$JAR" && fail "dopo l'uscita l'indizio dts_signed_in e' rimasto" \
  || pass "dopo l'uscita l'indizio dts_signed_in non c'e' piu'"

echo
if [ "$fails" -eq 0 ]; then echo "  auth smoke: tutto verde"; else echo "  auth smoke: $fails rossi"; exit 1; fi
