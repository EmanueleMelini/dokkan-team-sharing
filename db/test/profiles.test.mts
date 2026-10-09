// I profili pubblici e il cambio di handle (0026, lib/profiles.ts,
// lib/auth/handle-change.ts): la vista public_profile con le sole colonne
// pubbliche, gli indici, le regole di change_handle (forma, riservati,
// nomi presi o lasciati, 30 giorni, le sole maiuscole, riprendere il
// proprio nome), la corsa sotto il lock consultivo, /welcome che rifiuta i
// nomi lasciati da altri, la sospensione che nasconde il profilo, la
// cancellazione che libera i nomi; poi le letture vere di lib/profiles.ts.
//
// Gira dentro npm run db:test, dopo gli import. Crea solo gli utenti
// profiletest+...@example.invalid con i loro clear, e li toglie alla fine.
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { parseHandle } from '@/lib/profiles'
import { parseProfilePage, profileHref } from '@/lib/urls'
import {
  HANDLE_CONSTRAINTS, friendlyHandleError, nextHandleChange, soloMaiuscole,
} from '@/lib/auth/handle-change'
import { DOMINIO, check, guardia, num, q, stato } from '@/db/test/builder-helpers'
import { HANDLE_SQL, P, cambio, corsa, sospesoECancellato } from '@/db/test/profiles-handle'
import { HANDLE_LIB, letture, lista } from '@/db/test/profiles-lib'

guardia()
const vale = (nome: string, got: unknown, atteso: unknown) => {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  check(nome, g === a, g === a ? `= ${g}` : `= ${g}, atteso ${a}`)
}

function pure() {
  console.log('\n  -- funzioni pure')
  vale('parseHandle: valido', parseHandle('Goku_99'), 'Goku_99')
  for (const s of ['ab', 'a-b', 'x'.repeat(25), '%27', '', 'a%20b', '%E0%A4%A']) vale(`parseHandle("${s.slice(0, 10)}")`, parseHandle(s), null)
  vale('parseHandle decodifica', parseHandle('Goku%5F99'), 'Goku_99')
  vale('profileHref', [profileHref('Goku'), profileHref('Goku', 1), profileHref('Goku', 3)],
    ['/users/Goku', '/users/Goku', '/users/Goku/p/3'])
  vale('parseProfilePage', ['2', '100000', '1', '0', '02', '100001', 'x', undefined].map(parseProfilePage),
    [2, 100000, null, null, null, null, null, null])
  const ieri = new Date(Date.now() - 86_400_000)
  const dopo = nextHandleChange(ieri)
  check('nextHandleChange: 30 giorni dopo l\'ultimo cambio', !!dopo && Math.round((dopo.getTime() - ieri.getTime()) / 86_400_000) === 30)
  vale('nextHandleChange: mai cambiato, o 31 giorni fa', [nextHandleChange(null), nextHandleChange(new Date(Date.now() - 31 * 86_400_000))], [null, null])
  vale('soloMaiuscole', [soloMaiuscole('Goku', 'GOKU'), soloMaiuscole('Goku', 'Goku'), soloMaiuscole('Goku', 'Gohan')], [true, false, false])

  // Ogni nome di vincolo che 0026 alza ha una frase, e la tabella non ne ha in piu'
  const sql = readFileSync(new URL('../migrations/0026_public_profiles.sql', import.meta.url), 'utf8')
  const nomi = [...new Set([...sql.matchAll(/constraint = '([a-z_]+)'/g)].map((m) => m[1]))]
  // already_onboarded non e' un errore per chi lo riceve: /welcome lo
  // tratta come "fatto" e prosegue (lib/auth/actions.ts onboardingError)
  const senza = nomi.filter((n) => n !== 'already_onboarded' && !friendlyHandleError({ constraint: n }))
  check('ogni rifiuto di 0026 ha una frase', nomi.length >= 6 && senza.length === 0, `${nomi.join(', ')}; senza: ${senza.join(', ')}`)
  check('la tabella delle frasi non ha nomi in piu\'', HANDLE_CONSTRAINTS.every((n) => nomi.includes(n)),
    HANDLE_CONSTRAINTS.filter((n) => !nomi.includes(n)).join(', '))
  check('un 23505 senza nome e\' "preso"', /taken/.test(friendlyHandleError({ code: '23505' }) ?? ''))
  vale('un errore sconosciuto non ha frase (e\' un guasto)', friendlyHandleError({ code: '23503' }), null)

  // I moduli puri non chiamano la cache di Next: i test li importano fuori da Next
  for (const f of ['lib/profiles.ts', 'lib/urls.ts', 'lib/auth/handle-change.ts']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
    check(`${f} senza 'use cache', cacheTag, cacheLife`, !/['"]use cache|cacheTag\(|cacheLife\(|next\/cache/.test(src))
  }
  // Il profilo legge gli utenti solo dalla vista
  const src = readFileSync(new URL('../../lib/profiles.ts', import.meta.url), 'utf8')
  check('lib/profiles.ts non legge app_user', !/\bapp_user\b/.test(src.replace(/^\s*\/\/.*$/gm, '')))
}

async function schema() {
  console.log('\n  -- schema')
  const colonne = await q<{ c: string }>(
    `select column_name as c from information_schema.columns where table_name = 'public_profile' order by ordinal_position`)
  vale('public_profile: esattamente le colonne pubbliche', colonne.map((r) => r.c),
    ['id', 'handle', 'reg', 'joined_at', 'clears', 'upvotes', 'comments'])
  const indici = await q<{ n: string; d: string }>(
    `select indexname as n, indexdef as d from pg_indexes where indexname in ('comment_by_author', 'clear_by_author')`)
  const def = (n: string) => indici.find((i) => i.n === n)?.d ?? ''
  check('comment_by_author su clear_comment (author_id)', /clear_comment .*\(author_id\)/.test(def('comment_by_author')), def('comment_by_author'))
  check('clear_by_author su (author_id, created_at desc, id desc)',
    /\(author_id, created_at DESC, id DESC\)/.test(def('clear_by_author')), def('clear_by_author'))
  check('handle_history: FK verso app_user on delete cascade', await num(
    `select count(*) from pg_constraint where conrelid = 'handle_history'::regclass and contype = 'f'
        and confrelid = 'app_user'::regclass and confdeltype = 'c'`) === 1)
  check('handle_history: la forma dell\'handle', await num(
    `select count(*) from pg_constraint where conname = 'handle_history_shape'`) === 1)
}

try {
  pure()
  await schema()
  const ids = await cambio()
  await corsa()
  await sospesoECancellato(ids)
  await lista(await letture())
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  // gli utenti della suite per email esatta: i clear, lo storico e il
  // resto vanno con loro (cascata)
  const emails = [...HANDLE_SQL, ...HANDLE_LIB].map((h) => `${P}+${h}${DOMINIO}`)
  await db.query(`delete from clear where author_id in (select id from app_user where email = any($1::text[]))`, [emails])
  await db.query('delete from app_user where email = any($1::text[])', [emails])
  check('pulizia: nessun utente di prova rimasto',
    (await q('select 1 from app_user where email = any($1::text[])', [emails])).length === 0)
  check('pulizia: nessun nome lasciato dei test', await num(
    `select count(*) from handle_history where handle ilike 'proftest%' or handle ilike 'proflib%'`) === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
