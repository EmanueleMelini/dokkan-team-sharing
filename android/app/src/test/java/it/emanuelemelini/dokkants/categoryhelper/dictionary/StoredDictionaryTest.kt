package it.emanuelemelini.dokkants.categoryhelper.dictionary

import it.emanuelemelini.dokkants.categoryhelper.update.CategoryUpdates
import it.emanuelemelini.dokkants.categoryhelper.update.CategoryUpdates.RemoteCategory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StoredDictionaryTest {

    // Unit tests run from the module directory
    private val bundled = DictionaryFormat.parse(java.io.File("src/main/assets/categories.json").readText()).dictionary

    /** The bundled entries as 0.4.0 had them: same slugs and names, no game ids, version 2. */
    private val legacy = CategoryDictionary(
        version = StoredDictionary.LEGACY_VERSION,
        categories = bundled.categories.filter { it.gameId in StoredDictionary.LEGACY_GAME_IDS }.map { it.copy(gameId = null) },
    )

    /** The payload the site would serve for the bundled categories plus a new one (100). */
    private val remote = bundled.categories.map { RemoteCategory(it.gameId!!, it.en, it.jp, it.aliases.sorted()) } +
        RemoteCategory(100, "Brand New Category", "新しいカテゴリ", listOf("bnc"))

    private fun ids(categories: List<Category>) = categories.mapNotNull { it.gameId }

    @Test
    fun `at start an unedited older copy is replaced, an edited one or an up to date one is kept`() {
        val v2 = legacy
        val v3WithAdditions = bundled.copy(categories = bundled.categories + Category("brand_new_category", "Brand New Category", "新しいカテゴリ", gameId = 100))
        assertFalse(StoredDictionary.keepStored(v2, edited = false, bundled = bundled))
        assertTrue(StoredDictionary.keepStored(v2, edited = true, bundled = bundled))
        assertTrue(StoredDictionary.keepStored(v3WithAdditions, edited = false, bundled = bundled))
        // No stored copy, or an unreadable one (load() passes null): the bundled one
        assertFalse(StoredDictionary.keepStored(null, edited = false, bundled = bundled))
        assertFalse(StoredDictionary.keepStored(null, edited = true, bundled = bundled))
    }

    @Test
    fun `the legacy ids are the 99 slugs of the bundled dictionary`() {
        assertEquals(99, legacy.categories.size)
        assertEquals((1..99).toSet(), StoredDictionary.LEGACY_GAME_IDS)
    }

    @Test
    fun `entries without a game id get the bundled one with the same slug, if it is free`() {
        val categories = listOf(
            // 0.4.0 entry, both names renamed by the user: the slug still says which one it is
            Category("pure_saiyans", "My Saiyans", "サイヤ人（私の）"),
            // Hand-made, with a slug the bundled dictionary does not have
            Category("my_category", "My Category", "私の"),
            // The bundled slug of game id 12, but another entry already has 12
            Category("super_saiyan_3", "Super Saiyan 3", "超サイヤ人3"),
            Category("ssj3_mine", "SSJ3", "超サイヤ人３", gameId = 12),
        )
        val filled = StoredDictionary.withBundledGameIds(categories, bundled.categories)
        assertEquals(listOf(17, null, null, 12), filled.map { it.gameId })
        assertEquals(categories.map { it.copy(gameId = null) }, filled.map { it.copy(gameId = null) })
        // Nothing to fill: the same list
        val complete = bundled.categories
        assertTrue(StoredDictionary.withBundledGameIds(complete, bundled.categories) === complete)
    }

    @Test
    fun `removed ids follow deletes, undo and a replace import`() {
        val before = bundled.categories
        val afterDelete = before.filterNot { it.gameId == 4 }
        val removed = StoredDictionary.removedAfter(emptySet(), before, afterDelete)
        assertEquals(setOf(4), removed)
        // Undo puts it back
        assertEquals(emptySet<Int>(), StoredDictionary.removedAfter(removed, afterDelete, before))
        // Replace with a curated list of 10: every other category is removed, and 4 stays removed
        val curated = before.filter { it.gameId in 11..20 }
        assertEquals((1..99).toSet() - (11..20), StoredDictionary.removedAfter(removed, afterDelete, curated))
        // An edit that keeps the game id changes nothing
        val edited = before.map { if (it.gameId == 17) it.copy(en = "Mine", aliases = emptyList()) else it }
        assertEquals(setOf(4), StoredDictionary.removedAfter(setOf(4), afterDelete, edited.filterNot { it.gameId == 4 }))
    }

    @Test
    fun `a 0_4_0 dictionary counts the legacy categories it lacks as removed`() {
        val deleted = legacy.copy(categories = legacy.categories.filterNot { it.id == "peppy_gals" })
        val filled = StoredDictionary.withBundledGameIds(deleted.categories, bundled.categories)
        assertEquals(setOf(4), StoredDictionary.initialRemoved(deleted, filled))
        // All deleted
        val empty = legacy.copy(categories = emptyList())
        assertEquals(StoredDictionary.LEGACY_GAME_IDS, StoredDictionary.initialRemoved(empty, emptyList()))
        // A dictionary with game ids, or a newer version, has none
        assertEquals(emptySet<Int>(), StoredDictionary.initialRemoved(bundled, bundled.categories))
        val v3NoIds = deleted.copy(version = 3)
        assertEquals(emptySet<Int>(), StoredDictionary.initialRemoved(v3NoIds, filled))
    }

    @Test
    fun `the removed ids file round trips and ignores garbage`() {
        assertEquals("4\n12\n100\n", StoredDictionary.encodeRemoved(setOf(100, 4, 12)))
        assertEquals(setOf(4, 12, 100), StoredDictionary.parseRemoved("4\n12\n100\n"))
        assertEquals(setOf(4, 7), StoredDictionary.parseRemoved("4\r\n x\n-3\n0\n7, 4\n1.5\n"))
        assertEquals(emptySet<Int>(), StoredDictionary.parseRemoved(""))
        assertEquals("", StoredDictionary.encodeRemoved(emptySet()))
    }

    @Test
    fun `check for updates does not add back what the user removed`() {
        // Deleted a bundled category: only the new one comes
        val local = bundled.categories.filterNot { it.gameId == 4 }
        val removed = StoredDictionary.removedAfter(emptySet(), bundled.categories, local)
        assertEquals(listOf(100), ids(CategoryUpdates.newCategories(local, remote, removed)))

        // Deleted a category that an earlier check added: it does not come back
        val withNew = local + CategoryUpdates.newCategories(local, remote, removed)
        val afterDelete = withNew.filterNot { it.gameId == 100 }
        val removed2 = StoredDictionary.removedAfter(removed, withNew, afterDelete)
        assertEquals(emptyList<Int>(), ids(CategoryUpdates.newCategories(afterDelete, remote, removed2)))

        // Replace import of a curated list of 10: nothing old comes back, the new one does
        val curated = bundled.categories.filter { it.gameId in 11..20 }
        val removed3 = StoredDictionary.removedAfter(emptySet(), bundled.categories, curated)
        assertEquals(listOf(100), ids(CategoryUpdates.newCategories(curated, remote, removed3)))

        // Restore forgets them: the next check adds back only what the bundled dictionary lacks
        assertEquals(listOf(100), ids(CategoryUpdates.newCategories(bundled.categories, remote, emptySet())))
    }

    @Test
    fun `an edited 0_4_0 dictionary gets no duplicates and no deleted category back`() {
        // Renamed both names of Pure Saiyans, deleted Peppy Gals
        val stored = legacy.copy(
            categories = legacy.categories
                .filterNot { it.id == "peppy_gals" }
                .map { if (it.id == "pure_saiyans") it.copy(en = "My Saiyans", jp = "サイヤ人（私の）") else it },
        )
        val filled = StoredDictionary.withBundledGameIds(stored.categories, bundled.categories)
        val removed = StoredDictionary.initialRemoved(stored, filled)
        assertNull(filled.firstOrNull { it.id == "peppy_gals" })
        assertEquals(listOf(100), ids(CategoryUpdates.newCategories(filled, remote, removed)))
    }
}
