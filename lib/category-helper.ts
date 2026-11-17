// L'app Android DokkanTS Category Helper (android/): dove si scarica e da
// dove prende le categorie nuove. Modulo puro: lo leggono la pagina
// /category-helper e i test. L'APK sta nelle release di GitHub del
// repository pubblico, con un nome fisso: "latest" porta sempre all'ultima.

const REPO = 'https://github.com/EmanueleMelini/dokkan-team-sharing'

export const CATEGORY_HELPER = {
  nome: 'DokkanTS Category Helper',
  pagina: '/category-helper',
  apk: `${REPO}/releases/latest/download/dokkants-category-helper.apk`,
  release: `${REPO}/releases`,
  /** la rete dell'app verso il sito: "Update categories", il pulsante e il controllo automatico (al più una volta al giorno, all'apertura di Dokkan). Dalla 1.2.0 l'app chiede anche a GitHub l'ultima versione (api.github.com, mai il sito) */
  api: '/api/v1/categories',
  /** minSdk 26 */
  android: '8.0',
} as const
