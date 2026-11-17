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
  /** l'unica rete dell'app: il pulsante "Check for updates" */
  api: '/api/v1/categories',
  /** minSdk 26 */
  android: '8.0',
} as const
