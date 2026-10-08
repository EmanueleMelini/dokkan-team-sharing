// Ogni tabella di public, classificata. La legge db/prod/snapshot.mjs e
// la usa il controllo dell'aggiornamento settimanale (compare.mjs):
//
//   content  dati di gioco, li scrivono gli importer. Si confrontano riga
//            per riga (aggiunte, tolte, cambiate) e hanno limiti alle
//            cancellazioni (limits.json);
//   user     cio' che scrivono gli utenti. Un import non deve cambiarne
//            nemmeno un byte: molte FK partono da event, stage e card con
//            on delete cascade, e un evento tolto per sbaglio porterebbe
//            via i clear. Nessun --allow-deletions lo scavalca;
//   system   la contabilita' degli script (migrazioni, registro dei giri):
//            cambia a ogni import per costruzione, non si confronta.
//
// Una tabella nuova che non sta qui fa fallire lo snapshot (e il test):
// chi la aggiunge deve dire di che tipo e', invece di sfuggire al
// controllo in silenzio.
//
// key: le colonne della chiave naturale, se la primary key non basta o e'
// un id che cambia a ogni import. keySql: un'espressione SQL al posto
// delle colonne. ignore: colonne che cambiano a ogni giro senza che il
// dato cambi (orari di import), fuori dall'hash della riga.

/** @typedef {{ class: 'content', key?: string[], keySql?: string, ignore?: string[] }} Content */
/** @typedef {{ class: 'user' } | { class: 'system' }} Other */
/** @type {Record<string, Content | Other>} */
export const TABLES = {
  // ---- dati di gioco
  card: { class: 'content', ignore: ['imported_at'] },
  card_text: { class: 'content' },
  card_release: { class: 'content' },
  card_category: { class: 'content' },
  card_link: { class: 'content' },
  card_skill: { class: 'content', key: ['card_id', 'locale', 'kind', 'tier', 'seq'] },
  category: { class: 'content' },
  category_text: { class: 'content' },
  link_skill: { class: 'content' },
  link_skill_text: { class: 'content' },
  event: { class: 'content', ignore: ['imported_at'] },
  event_text: { class: 'content' },
  // l'id della run e' un surrogato: la chiave vera e' evento, regione, inizio
  event_run: { class: 'content', key: ['event_id', 'reg', 'starts_at'] },
  event_game_ref: { class: 'content', key: ['game_kind', 'game_id'] },
  stage: { class: 'content' },
  stage_text: { class: 'content' },
  stage_tier: { class: 'content' },
  stage_tier_text: { class: 'content' },
  // la missione del gioco quando c'e', altrimenti il nostro id
  mission: { class: 'content', keySql: `coalesce(game_mission_id::text, 'id:' || id::text)` },
  mission_text: { class: 'content' },
  mission_reward: { class: 'content' },
  game_item: { class: 'content', key: ['item_type', 'item_id'] },
  game_item_text: { class: 'content' },
  reward_item: { class: 'content' },
  reward_item_text: { class: 'content' },
  equipment: { class: 'content' },
  equipment_text: { class: 'content' },
  equipment_limit: { class: 'content' },
  equipment_limit_type: { class: 'content' },
  equipment_limit_category: { class: 'content' },
  equipment_limit_card: { class: 'content' },
  potential_skill: { class: 'content' },
  asset: { class: 'content', key: ['key'], ignore: ['fetched_at'] },
  type_icon: { class: 'content' },
  rarity_icon: { class: 'content' },
  // riferimenti scritti dalle migrazioni, non dagli importer: content
  // perche' non sono degli utenti, e un import che li toccasse si vedrebbe
  locale: { class: 'content' },
  region_locale: { class: 'content' },
  proof_host: { class: 'content' },

  // ---- degli utenti
  app_user: { class: 'user' },
  auth_account: { class: 'user' },
  auth_session: { class: 'user' },
  auth_verification: { class: 'user' },
  auth_rate_limit: { class: 'user' },
  auth_email_send: { class: 'user' },
  team: { class: 'user' },
  lineup: { class: 'user' },
  lineup_slot: { class: 'user' },
  slot_build: { class: 'user' },
  slot_orb: { class: 'user' },
  slot_equipment: { class: 'user' },
  clear: { class: 'user' },
  clear_version: { class: 'user' },
  clear_card: { class: 'user' },
  clear_proof: { class: 'user' },
  clear_vote: { class: 'user' },
  clear_comment: { class: 'user' },
  clear_lineup: { class: 'user' },
  clear_lineup_card: { class: 'user' },
  clear_lineup_build: { class: 'user' },
  clear_lineup_equipment: { class: 'user' },
  clear_write_log: { class: 'user' },
  tip: { class: 'user' },
  tip_vote: { class: 'user' },
  report: { class: 'user' },
  // il registro della moderazione (0024): lo scrivono gli admin, mai un import
  moderation_action: { class: 'user' },

  // ---- degli script
  schema_migrations: { class: 'system' },
  import_run: { class: 'system' },
}

// Pura, per i test: le tabelle del database che qui non ci sono.
/** @param {Iterable<string>} names */
export function unclassified(names) {
  return [...names].filter((n) => !Object.hasOwn(TABLES, n)).sort()
}
