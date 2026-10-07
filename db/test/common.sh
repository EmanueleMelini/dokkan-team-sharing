# Sorgente comune dei test: su quale database girano, e gli aiutanti per
# le verifiche. Lo includono le due suite shell, run.sh e queries.test.sh.
#
# I test ricreano il database da zero e ci scrivono: non devono MAI finire
# su dokkan_dev, dove stanno i dati importati che il sito legge. Per questo
# qui DATABASE_URL non vale (in .env.local punta allo sviluppo): vale
# TEST_DATABASE_URL, e per difetto un database a parte, dokkan_test, sullo
# stesso server che indica pgenv.sh.
#
# Una variabile sola per node e per psql. Prima il reset (node, che legge
# DATABASE_URL) e le verifiche (psql, che legge PG*) avevano due sorgenti
# diverse, e potevano finire su due database diversi senza dirlo.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
. db/pgenv.sh

if [ -n "${DATABASE_URL:-}" ] && [ "$DATABASE_URL" != "${TEST_DATABASE_URL:-}" ]; then
  echo "  (ignoro DATABASE_URL: i test usano TEST_DATABASE_URL)"
fi
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://$PGUSER@$PGHOST:$PGPORT/dokkan_test}"

# utente, host, porta e nome dall'URL; la password non si stampa mai
re='^postgres(ql)?://(([^:@/]*)(:[^@/]*)?@)?([^/:?#]*)(:([0-9]+))?/([^/?#]+)([?#].*)?$'
if [[ ! $TEST_DATABASE_URL =~ $re ]]; then
  echo "  non capisco TEST_DATABASE_URL: serve postgres://utente@host:porta/nome_test" >&2
  exit 2
fi
TEST_DB=${BASH_REMATCH[8]}
# Un ?host= o ?port= nella query string sposterebbe psql e node su server
# diversi senza che il nome lo dica: l'URL di test deve essere esplicito.
if [ -n "${BASH_REMATCH[9]}" ]; then
  echo "  TEST_DATABASE_URL non deve avere parametri (?...): host e porta vanno nell'URL" >&2
  exit 2
fi
TEST_TARGET="${BASH_REMATCH[5]:-(socket)}:${BASH_REMATCH[7]:-5432}/$TEST_DB come ${BASH_REMATCH[3]:-(default)}"

# Il nome e' la seconda barriera, dopo quella di reset.mjs (che guarda
# dentro il database). Serve qui perche' dokkan_dev e' "nostro" per
# reset.mjs: contiene schema_migrations, e lo cancellerebbe volentieri.
case $TEST_DB in
  *_test) ;;
  *) echo "  mi fermo: i test girano solo su un database il cui nome finisce per _test" >&2
     echo "  (risolto: $TEST_TARGET)" >&2
     exit 2 ;;
esac
export DATABASE_URL=$TEST_DATABASE_URL
export TEST_DB TEST_TARGET
# Se un psql senza -d sfuggisse, finirebbe comunque sul database di test,
# non su quello di sviluppo che pgenv.sh mette per difetto.
export PGDATABASE=$TEST_DB

# Un URI passato a -d vince su PGHOST/PGPORT/PGUSER: e' cio' che tiene psql
# sullo stesso database di node. -X ignora un eventuale ~/.psqlrc.
pq () { psql -X -d "$DATABASE_URL" "$@"; }

# Da chiamare quando il database esiste: e' il server a dire dove siamo
# davvero, non la stringa che abbiamo composto.
conferma_psql () {
  local dove
  dove=$(pq -qtAc "select coalesce(host(inet_server_addr()), '(socket)')||':'||
                          coalesce(inet_server_port()::text, '?')||'/'||current_database()||
                          ' come '||current_user" 2>&1) || {
    echo "  psql non raggiunge $TEST_TARGET: $dove" >&2; exit 1; }
  echo "  psql: $dove"
  case $dove in
    */"$TEST_DB"\ come\ *) ;;
    *) echo "  mi fermo: psql e' su un database diverso da $TEST_DB" >&2; exit 1 ;;
  esac
}

fails=0
pass () { printf '  PASS  %s\n' "$1"; }
fail () { printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }
primo_errore () { grep -m1 -E 'ERRO|FATAL' <<<"$1" || head -1 <<<"$1"; }

# t nome sql ok
# t nome sql fail 'regex del messaggio atteso'
# Un rifiuto vale solo se e' QUELLO atteso: un errore qualsiasi (una
# sintassi rotta da un id vuoto, un vincolo diverso) non e' la prova che il
# vincolo giusto morda. Lo SQLSTATE da solo non basta, 23514 e' di tutti i
# CHECK: si confronta il messaggio, o il nome del vincolo che contiene.
t () {
  local out got
  if out=$(pq -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q -c "$2" 2>&1); then got=ok; else got=fail; fi
  if [ "$3" = ok ]; then
    if [ "$got" = ok ]; then pass "$1"; else fail "$1 (respinto, atteso ok: $(primo_errore "$out"))"; fi
  elif [ -z "${4:-}" ]; then
    fail "$1 (la verifica non dice quale errore si aspetta)"
  elif [ "$got" = ok ]; then
    fail "$1 (accettato, atteso un rifiuto)"
  # Solo nelle righe ERROR/FATAL: l'output verbose ripete anche l'SQL
  # (LINE 1:) e i valori della riga (DETAIL:), e un'espressione che compare
  # nel testo del test passerebbe senza che il vincolo abbia morso.
  elif grep -E '(^|: )(ERROR|ERRORE|FATAL|FATALE):' <<<"$out" | grep -qE -- "$4"; then
    pass "$1"
  else
    fail "$1 (respinto, ma non per il motivo atteso: $(primo_errore "$out"))"
  fi
}

eq () { # nome, sql-che-torna-un-valore, atteso
  local got
  got=$(pq -tAc "$2" 2>&1)
  if [ "$got" = "$3" ]; then printf '  PASS  %s (= %s)\n' "$1" "$got"
  else fail "$1 (= $got, atteso $3)"; fi
}

q () { pq -v ON_ERROR_STOP=1 -qtAc "$1"; }

# Preparazione che deve riuscire: se fallisce, le verifiche dopo
# misurerebbero un'altra cosa.
prep () {
  local out
  out=$(pq -v ON_ERROR_STOP=1 -q -c "$1" 2>&1) || {
    printf '  FAIL  preparazione fallita, mi fermo: %s\n' "$(primo_errore "$out")"; exit 1; }
}

# need VAR...: una ricerca vuota non fa fallire niente da sola. L'id finisce
# interpolato nell'SQL, l'SQL diventa invalido, e una verifica che si
# aspetta un rifiuto passava per l'errore di sintassi.
need () {
  local v
  for v in "$@"; do
    case "${!v:-}" in
      '') printf "  FAIL  %s e' vuoto: manca il dato di partenza, mi fermo\n" "$v"; exit 1 ;;
      *$'\n'*) printf "  FAIL  %s ha piu' di un valore, mi fermo\n" "$v"; exit 1 ;;
    esac
  done
}

# Node con i tipi tolti al volo e gli alias @/ di tsconfig, per provare le
# funzioni vere di lib/ senza un passo di build. Gli avvisi tolti sono
# quelli attesi: strip-types e' sperimentale su Node 22, e package.json non
# dichiara "type" (non va aggiunto: cambierebbe il significato dei .js).
node_ts () {
  node --experimental-strip-types \
       --disable-warning=ExperimentalWarning \
       --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
       --import ./db/test/alias.mjs "$@"
}
