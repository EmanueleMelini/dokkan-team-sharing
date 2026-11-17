package it.emanuelemelini.dokkants.categoryhelper.appupdate

/**
 * The notes of one version: "- " bullets by language. The single source is
 * `assets/release-notes/X.Y.Z.md`, which is also the body of the GitHub release:
 *
 * ```
 * An optional intro line (GitHub only).
 *
 * - English bullet.
 *
 * <!-- dch-notes:it
 * - Italian bullet.
 * -->
 * ```
 *
 * The English bullets are visible on GitHub; the Italian ones are in a hidden HTML comment. The app
 * shows the bullets only (no intro line), in its own language when the file has them, else in English.
 */
data class ReleaseNotes(val bullets: Map<String, List<String>>) {

    /** The bullets in [language] ("it"), or the English ones when that language has none. */
    fun forLanguage(language: String): List<String> =
        bullets[language]?.takeIf { it.isNotEmpty() } ?: bullets[ENGLISH].orEmpty()

    val isEmpty: Boolean get() = bullets.values.all { it.isEmpty() }

    /** The same notes as a notes file (English bullets, then one hidden block per other language): [parse] reads it back. */
    fun format(): String = buildString {
        bullets[ENGLISH].orEmpty().forEach { append("- ").append(safe(it)).append('\n') }
        bullets.filterKeys { it != ENGLISH }.toSortedMap().forEach { (language, lines) ->
            if (lines.isEmpty()) return@forEach
            if (isNotEmpty()) append('\n')
            append("<!-- ").append(MARKER).append(language).append('\n')
            lines.forEach { append("- ").append(safe(it)).append('\n') }
            append("-->\n")
        }
    }

    companion object {
        const val ENGLISH = "en"
        const val MARKER = "dch-notes:"

        /** Far more than a release needs: a body that is not ours cannot fill the settings. */
        internal const val MAX_BULLETS = 30
        internal const val MAX_BULLET_CHARS = 500

        val EMPTY = ReleaseNotes(emptyMap())

        private val HIDDEN_BLOCK = Regex("""<!--\s*dch-notes:([a-z]{2,3})\s(.*?)-->""", RegexOption.DOT_MATCHES_ALL)

        // An unclosed comment hides the rest of the text on GitHub too
        private val HTML_COMMENT = Regex("""<!--.*?(?:-->|\z)""", RegexOption.DOT_MATCHES_ALL)

        /** Reads a notes file or a release body (CRLF too, as GitHub stores a body edited on the site). */
        fun parse(text: String): ReleaseNotes {
            val normalized = text.replace("\r\n", "\n").replace('\r', '\n')
            val bullets = linkedMapOf<String, List<String>>()
            bullets(normalized.replace(HTML_COMMENT, "")).takeIf { it.isNotEmpty() }?.let { bullets[ENGLISH] = it }
            HIDDEN_BLOCK.findAll(normalized).forEach { match ->
                val language = match.groupValues[1]
                if (language != ENGLISH && language !in bullets) {
                    bullets(match.groupValues[2]).takeIf { it.isNotEmpty() }?.let { bullets[language] = it }
                }
            }
            return ReleaseNotes(bullets)
        }

        private fun bullets(text: String): List<String> = text.lines()
            .map { it.trim() }
            .filter { it.startsWith("- ") || it.startsWith("* ") }
            .map { it.drop(2).trim() }
            .filter { it.isNotEmpty() }
            .map { if (it.length > MAX_BULLET_CHARS) it.take(MAX_BULLET_CHARS - 1) + "…" else it }
            .take(MAX_BULLETS)

        /**
         * A bullet never opens or closes a comment of the formatted text. Repeated until nothing changes:
         * one pass would turn "<!---" into "<!--" and "--->" into "-->".
         */
        internal fun safe(bullet: String): String {
            var text = bullet
            while (true) {
                val next = text.replace("<!--", "<!-").replace("-->", "->")
                if (next == text) return text
                text = next
            }
        }
    }
}
