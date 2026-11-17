package it.emanuelemelini.dokkants.categoryhelper.search

import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import java.text.Normalizer
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

/**
 * Search over the English names and aliases (and the Japanese names, for kana queries).
 *
 * Ranking, best first: exact match, prefix, word prefix, contains, contains without spaces,
 * all query words as word prefixes in any order, then typo-tolerant matches by number of typos.
 * At the same level the English name beats an alias; ties go to the shorter, then alphabetical name.
 */
object CategorySearch {

    const val DEFAULT_LIMIT = 50

    /** Lower case, full-width folded, apostrophes dropped, other punctuation and runs of spaces → one space. */
    fun normalize(text: String): String {
        val folded = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase(Locale.ROOT)
        val out = StringBuilder(folded.length)
        var pendingSpace = false
        for (ch in folded) {
            when {
                ch == '\'' || ch == '’' || ch == '`' -> Unit
                ch.isLetterOrDigit() -> {
                    if (pendingSpace && out.isNotEmpty()) out.append(' ')
                    pendingSpace = false
                    out.append(ch)
                }
                else -> pendingSpace = true
            }
        }
        return out.toString()
    }

    fun search(query: String, categories: List<Category>, limit: Int = DEFAULT_LIMIT): List<Category> {
        val q = normalize(query)
        if (q.isEmpty()) return emptyList()
        val queryWords = q.split(' ')
        return categories
            .mapNotNull { category -> score(category, q, queryWords)?.let { category to it } }
            .sortedWith(
                compareBy<Pair<Category, Int>> { it.second }
                    .thenBy { it.first.en.length }
                    .thenBy { it.first.en.lowercase(Locale.ROOT) },
            )
            .take(limit)
            .map { it.first }
    }

    private fun score(category: Category, q: String, queryWords: List<String>): Int? {
        var best: Int? = null
        val candidates = sequenceOf(category.en) + category.aliases.asSequence() + sequenceOf(category.jp)
        for ((index, raw) in candidates.withIndex()) {
            val candidate = normalize(raw)
            if (candidate.isEmpty()) continue
            val level = matchLevel(candidate, q, queryWords) ?: continue
            // Same level: the English name ranks above aliases and the Japanese name
            val ranked = level * 2 + if (index == 0) 0 else 1
            if (best == null || ranked < best) best = ranked
        }
        return best
    }

    /** 0 exact … 5 all words as prefixes, 6+ typo-tolerant (5 + typos); null if no match. */
    private fun matchLevel(candidate: String, q: String, queryWords: List<String>): Int? {
        if (candidate == q) return 0
        if (candidate.startsWith(q)) return 1
        val words = candidate.split(' ')
        if (words.any { it.startsWith(q) }) return 2
        if (candidate.contains(q)) return 3
        val compactQuery = q.replace(" ", "")
        if (compactQuery.length >= 3 && candidate.replace(" ", "").contains(compactQuery)) return 4

        var typos = 0
        for (word in queryWords) {
            typos += wordDistance(word, words) ?: return null
        }
        return 5 + typos
    }

    /** 0 if some candidate word starts with [word], else the fewest typos against a word's start, if allowed. */
    private fun wordDistance(word: String, candidateWords: List<String>): Int? {
        if (candidateWords.any { it.startsWith(word) }) return 0
        val allowed = when {
            word.length < 3 -> return null
            word.length <= 5 -> 1
            else -> 2
        }
        var best = Int.MAX_VALUE
        for (target in candidateWords) {
            val from = max(1, word.length - allowed)
            val to = min(target.length, word.length + allowed)
            for (length in from..to) {
                best = min(best, editDistance(word, target.substring(0, length)))
            }
        }
        return best.takeIf { it <= allowed }
    }

    /** Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps. */
    internal fun editDistance(a: String, b: String): Int {
        val d = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in 0..a.length) d[i][0] = i
        for (j in 0..b.length) d[0][j] = j
        for (i in 1..a.length) {
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                var value = min(min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost)
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
                    value = min(value, d[i - 2][j - 2] + 1)
                }
                d[i][j] = value
            }
        }
        return d[a.length][b.length]
    }
}
