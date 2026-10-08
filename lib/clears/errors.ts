// Gli errori del database tradotti per chi usa il sito. Il builder (0016)
// mette un nome in CONSTRAINT su ogni rifiuto: si traduce il nome, mai il
// testo del messaggio, che e' italiano e puo' cambiare.

export type DbErrorLike = { code?: string; constraint?: string }

const BY_CONSTRAINT: Record<string, string> = {
  builder_payload: 'The clear could not be read. Reload the page.',
  builder_lineup_count: 'A clear has a starting team and at most 3 changes.',
  builder_lineup_label: 'Give each team change a short name, under 40 characters.',
  builder_lineup_note: 'Keep the note of each team under 500 characters.',
  builder_shape: 'Each team needs 7 units in the 2+2+3 rotation shape.',
  builder_role: 'Mark exactly one leader and one friend in each team.',
  builder_card: 'One of the cards was not found. Pick it again.',
  builder_flags: 'The clear could not be read. Reload the page.',
  builder_turns: 'Turns must be a whole number from 1 to 99, or empty.',
  builder_note: 'Keep the note under 2000 characters.',
  builder_lang: 'Choose the language of the note.',
  builder_proof_count: 'Add at most 3 proof links.',
  builder_proof_kind: 'Each proof is a screenshot or a video.',
  builder_proof_url: 'Proof links must be full https:// addresses, each one once.',
  builder_proof_host: 'That proof host is not accepted. Paste the full address, not a shortened link.',
  builder_tier: 'That difficulty no longer exists. Reload the page.',
  builder_run: 'That run belongs to another event. Pick a run of this event.',
  builder_run_not_started: 'That run has not started yet. Pick a run that is open or over.',
  builder_rate_limit: 'You have posted a lot in the last hour. Try again later.',
  builder_author: 'Finish setting up your account first.',
  builder_not_yours: 'This clear does not exist or is not yours.',
  builder_change_note: 'Say what changed in this revision, in under 300 characters.',
  builder_version_missing: 'This clear is no longer available.',
  builder_version_stale: 'This clear was revised while you were reading it. Reload the page to see the new version.',
  builder_vote_value: 'That vote could not be read. Reload the page.',
  builder_own_vote: 'You cannot vote on your own clear.',
  builder_comment: 'Comments must have text and stay under 1000 characters.',
  // le build degli slot (0018)
  builder_build: 'A card build could not be read. Reload the page.',
  builder_build_routes: 'Hidden Potential routes go from 0 to 4.',
  builder_build_path: 'Keep the Hidden Potential path under 40 characters.',
  builder_build_note: 'Keep each build note under 200 characters.',
  builder_build_equipment: 'A card holds at most 3 Skill Orbs, and each one must exist. Pick them again.',
}

/**
 * La frase da mostrare, o null se l'errore non e' uno di quelli previsti
 * (allora l'azione lo rilancia: e' un guasto, non un input sbagliato).
 */
export function friendlyClearError(e: DbErrorLike): string | null {
  if (e.constraint && BY_CONSTRAINT[e.constraint]) return BY_CONSTRAINT[e.constraint]
  // delete_clear e revise_clear (0002) non danno un nome: 42501 e' "non tuo"
  if (e.code === '42501') return 'This clear does not exist or is not yours.'
  return null
}
