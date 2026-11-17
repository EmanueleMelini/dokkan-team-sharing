package it.emanuelemelini.dokkants.categoryhelper.appupdate

/**
 * A version of the app, "X.Y.Z" (the versionName, the release tag without its prefix, the name of
 * a notes file). A suffix after "-" or "+" is ignored, so the debug build "1.2.0-debug" is 1.2.0;
 * missing parts count as 0 ("1.2" == "1.2.0").
 */
class AppVersion private constructor(private val parts: List<Int>) : Comparable<AppVersion> {

    override fun compareTo(other: AppVersion): Int {
        for (i in 0 until maxOf(parts.size, other.parts.size)) {
            val diff = parts.getOrElse(i) { 0 }.compareTo(other.parts.getOrElse(i) { 0 })
            if (diff != 0) return diff
        }
        return 0
    }

    override fun equals(other: Any?): Boolean = other is AppVersion && compareTo(other) == 0

    override fun hashCode(): Int = parts.dropLastWhile { it == 0 }.hashCode()

    /** Always three parts: "1.2.0". */
    override fun toString(): String = (parts + List(maxOf(0, 3 - parts.size)) { 0 }).joinToString(".")

    companion object {
        private val CORE = Regex("""\d{1,6}(\.\d{1,6}){0,2}""")

        /** Null when [text] is not a version. */
        fun parse(text: String): AppVersion? {
            val core = text.trim().substringBefore('-').substringBefore('+')
            if (!CORE.matches(core)) return null
            return AppVersion(core.split('.').map { it.toInt() })
        }
    }
}
