#!/usr/bin/env node
// L'Ignored Build Step di Vercel (vercel.json ignoreCommand): esce 0 per
// saltare il deploy, 1 per costruirlo. Le regole sono in
// vercel-ignore-decidi.mjs; qui si lancia git e si esce col suo esito.
//
// Questo file decide sempre, senza chiedersi se e' il modulo principale: un
// controllo come import.meta.url === argv[1] fallisce quando il percorso
// passa da un link simbolico, e un processo che esce 0 senza dire niente per
// Vercel vuol dire "salta". Se l'import del modulo fallisce Node esce 1, e il
// deploy si costruisce.
import { spawnSync } from 'node:child_process'
import { decidi } from './vercel-ignore-decidi.mjs'

/** git senza input, con l'output intero: con un buffer pieno lo status e' null, e si costruisce. */
const git = (args) => spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })

let r
try {
  r = decidi(process.env, git)
} catch (err) {
  r = { esito: 1, motivo: `unexpected error (${err?.message ?? err}): building` }
}
console.log(`ignored build step: ${r.motivo}`)
process.exit(r.esito === 0 ? 0 : 1)
