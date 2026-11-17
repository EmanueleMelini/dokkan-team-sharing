package it.emanuelemelini.dokkants.categoryhelper.dictionary

/**
 * The pure rules behind [DictionaryRepository], unit tested without Android:
 * - which dictionary to use at start (the stored copy or the bundled one);
 * - game ids for entries that lack one, taken from the bundled entry with the same id (slug);
 * - the game ids the user removed (deleted, or left out of a "Replace" import), so that "Check for
 *   updates" does not add them back. They are kept apart from the dictionary file (exports and
 *   the bundled asset do not carry them) and forgotten by "Restore".
 */
object StoredDictionary {

    /** `version` of the bundled dictionary of 0.4.0, the last one without game ids. */
    const val LEGACY_VERSION = 2

    /** The game categories that dictionary held (the same 99 slugs as version 3, with these game ids). */
    val LEGACY_GAME_IDS: Set<Int> = (1..99).toSet()

    /**
     * Keep the stored copy (true) or install the bundled one (false): an edited copy is always
     * kept; an unedited one only while the bundled dictionary is not newer. No stored copy (first
     * start, or an unreadable file) means the bundled one.
     */
    fun keepStored(stored: CategoryDictionary?, edited: Boolean, bundled: CategoryDictionary): Boolean =
        stored != null && (edited || stored.version >= bundled.version)

    /**
     * Entries without a game id get the one of the bundled entry with the same id, if no entry
     * has it yet. A dictionary saved before game ids existed (0.4.0) or a file exported from it
     * has the same slugs as the bundled dictionary, so its entries are recognised again (even
     * after renaming both names, which name matching would miss).
     */
    fun withBundledGameIds(categories: List<Category>, bundled: List<Category>): List<Category> {
        if (categories.none { it.gameId == null }) return categories
        val bySlug = bundled.filter { it.gameId != null }.associateBy { it.id }
        val used = categories.mapNotNullTo(mutableSetOf()) { it.gameId }
        return categories.map { category ->
            val gameId = if (category.gameId == null) bySlug[category.id]?.gameId else null
            if (gameId != null && used.add(gameId)) category.copy(gameId = gameId) else category
        }
    }

    /** After a change: the game ids removed so far plus those there before, minus those there now. */
    fun removedAfter(removed: Set<Int>, before: List<Category>, after: List<Category>): Set<Int> {
        val now = after.mapNotNullTo(mutableSetOf()) { it.gameId }
        return (removed + before.mapNotNull { it.gameId }).filterTo(sortedSetOf()) { it !in now }
    }

    /**
     * The removed game ids of a stored dictionary that has none saved: none, except for an edited
     * dictionary of 0.4.0 (no game id anywhere, `version` at most [LEGACY_VERSION]), where every
     * legacy category it no longer has was deleted by the user. [filled] is the same dictionary
     * after [withBundledGameIds].
     */
    fun initialRemoved(stored: CategoryDictionary, filled: List<Category>): Set<Int> {
        if (stored.version > LEGACY_VERSION || stored.categories.any { it.gameId != null }) return emptySet()
        val present = filled.mapNotNullTo(mutableSetOf()) { it.gameId }
        return LEGACY_GAME_IDS.filterTo(sortedSetOf()) { it !in present }
    }

    /** The removed-ids file: one id per line. Anything that is not a positive number is ignored. */
    fun parseRemoved(text: String): Set<Int> =
        text.split('\n', '\r', ',', ' ', '\t')
            .mapNotNull { it.trim().toIntOrNull()?.takeIf { id -> id > 0 } }
            .toSortedSet()

    fun encodeRemoved(removed: Set<Int>): String = removed.sorted().joinToString("") { "$it\n" }
}
