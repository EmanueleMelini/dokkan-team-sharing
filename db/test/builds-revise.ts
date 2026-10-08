// Le build e le versioni (0018): una revisione cambia le build della
// versione nuova e lascia quelle vecchie come erano; le righe congelate
// non si toccano; le letture del builder e delle pagine le riportano.
// Parte di builds.test.mts, che prepara il clear con le build.
import { getClearForEdit, getVersionLineups } from '@/lib/clears'
import { listClears } from '@/lib/queries'
import {
  REVISE, SUBMIT, check, copia, messaggio, num, one, q, type Dati, type Payload,
} from '@/db/test/builder-helpers'

export type BuildCtx = {
  d: Dati
  autore: string
  altro: string
  clear: string
  v1: string
  base: Payload
  pieno: Payload
  orbs: number[]
  prefisso: string
}

const firma = (version: string) => q<{ k: string }>(
  `select b.seq || '.' || b.rotation_index || '.' || b.pos || ':' || coalesce(b.hp_routes::text, '-') || ':' ||
          coalesce(b.hp_path, '-') || ':' || coalesce((
            select string_agg(e.slot_no || '=' || e.equipment_id, ',' order by e.slot_no) from clear_lineup_equipment e
            where (e.version_id, e.seq, e.rotation_index, e.pos) = (b.version_id, b.seq, b.rotation_index, b.pos)), '-') as k
   from clear_lineup_build b where b.version_id = $1 order by b.seq, b.rotation_index, b.pos`, [version])
  .then((r) => r.map((x) => x.k).join(' | '))

export default async function revisione({ d, autore, altro, clear, v1, pieno, orbs }: BuildCtx) {
  console.log('\n  -- la revisione non tocca le build vecchie')
  const primaV1 = await firma(v1)
  const nuovo = copia(pieno)
  nuovo.lineups[0].slots[0].build = { hp_routes: 2, hp_path: 'Evasion', equipment: [orbs[2]] }
  delete nuovo.lineups[0].slots[3].build
  delete nuovo.lineups[1].slots[6].build
  nuovo.lineups[0].slots[6].build = { note: 'Friend with the same orbs.' }
  const v2 = (await one<{ id: string }>(REVISE, [autore, clear, 'Changed the builds', JSON.stringify(nuovo)])).id
  check('la versione 1 ha ancora le sue build', await firma(v1) === primaV1 && primaV1.split(' | ').length === 3, primaV1)
  const f2 = await firma(v2)
  check('la versione 2 ha le build nuove', f2 === `1.1.1:2:Evasion:1=${orbs[2]} | 1.3.3:-:-:-`, f2)
  check('il team riscritto ha solo le build nuove', await num(
    `select count(*) from slot_build b join lineup l on l.id = b.lineup_id join clear c on c.team_id = l.team_id
     where c.id = $1`, [clear]) === 2)

  console.log('\n  -- le righe congelate')
  check('una build congelata non si modifica', /non si modificano/.test(await messaggio(
    "update clear_lineup_build set note = 'x' where version_id = $1", [v1])))
  check('una build congelata non si cancella da sola', /non si cancellano/.test(await messaggio(
    'delete from clear_lineup_build where version_id = $1', [v1])))
  check('una sfera non si aggiunge dopo', /solo insieme/.test(await messaggio(
    `insert into clear_lineup_equipment (version_id, seq, rotation_index, pos, slot_no, equipment_id)
     values ($1, 1, 2, 2, 1, $2)`, [v1, orbs[0]])))
  check('una sfera congelata non si modifica', /non si modificano/.test(await messaggio(
    'update clear_lineup_equipment set equipment_id = $2 where version_id = $1', [v1, orbs[0]])))

  console.log('\n  -- le letture')
  const e = await getClearForEdit(clear, autore)
  const b11 = e?.payload.lineups[0].slots.find((s) => s.rot === 1 && s.pos === 1)?.build
  check('la modifica parte dalle build della versione corrente',
    JSON.stringify(b11) === JSON.stringify({ hp_routes: 2, hp_path: 'Evasion', note: null, equipment: [orbs[2]] }), JSON.stringify(b11))
  check('gli slot senza build non ne hanno una nel payload',
    e?.payload.lineups[0].slots.filter((s) => s.build).length === 2 && !e?.payload.lineups[1].slots.some((s) => s.build))
  const k11 = e?.lineups[0].cards.find((k) => k.rotation_index === 1 && k.pos === 1)
  // orbs[2] e' la bronzo (1)
  check('e con il nome e il grado della sfera', !!k11?.build?.equipment[0]?.name && k11.build.equipment[0].tier === 1,
    JSON.stringify(k11?.build))
  check('un altro utente non la vede', await getClearForEdit(clear, altro) === null)
  const cambi = await getVersionLineups([v1], 2)
  const k33 = cambi[0]?.cards.find((k) => k.rotation_index === 3 && k.pos === 3)
  check('getVersionLineups: il cambio della v1 ha la sua build', k33?.build?.equipment.length === 1 &&
    k33.build.equipment[0].slot === 2 && Number(k33.build.equipment[0].id) === orbs[1], JSON.stringify(k33?.build))
  const righe = await listClears(d.tier, 'global', { limit: 200 })
  const riga = righe.find((r) => r.id === clear)
  check('listClears: la squadra di partenza ha le build della versione corrente',
    riga?.cards.find((c) => c.rotation_index === 1 && c.pos === 1)?.build?.hp_path === 'Evasion' &&
    riga.cards.filter((c) => c.build).length === 2, JSON.stringify(riga?.cards.map((c) => c.build)))
  check('listClears: gli altri clear hanno build null', righe.filter((r) => r.id !== clear)
    .every((r) => r.cards.every((c) => c.build === null || r.handle === 'build_author')))

  if (e) {
    const v3 = (await one<{ id: string }>(REVISE, [autore, clear, 'Only fixed a typo', JSON.stringify(e.payload)])).id
    check('rivedere senza toccare le build le tiene uguali', await firma(v3) === f2, await firma(v3))
  }

  console.log('\n  -- la cancellazione')
  const piccolo = copia(pieno)
  const cx = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(piccolo)])).id
  await one('select delete_clear($1::uuid, $2::uuid)', [autore, cx])
  check('cancellare il clear porta via le sue build', await num(
    `select count(*) from clear_lineup_build b where not exists (select 1 from clear_version v where v.id = b.version_id)`) === 0 &&
    await num('select count(*) from clear where id = $1', [cx]) === 0)
}
