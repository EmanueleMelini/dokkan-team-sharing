package it.emanuelemelini.dokkants.categoryhelper.dictionary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DictionaryFormatTest {

    @Test
    fun `parses the spec format`() {
        val result = DictionaryFormat.parse(
            """
            {
              "version": 3,
              "categories": [
                { "id": "pure_saiyans", "en": "Pure Saiyans", "jp": "純粋サイヤ人", "aliases": ["pure", "saiyan"] }
              ]
            }
            """.trimIndent(),
        )
        assertEquals(3, result.dictionary.version)
        assertEquals(0, result.dropped)
        assertEquals(
            listOf(Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure", "saiyan"))),
            result.dictionary.categories,
        )
    }

    @Test
    fun `accepts a bare array, comments and trailing commas, and generates missing ids`() {
        val result = DictionaryFormat.parse(
            """
            [
              // hand written
              { "en": "Goku's Family", "jp": "孫悟空の家系", },
              { "en": "Goku's  family!", "jp": "別" },
            ]
            """.trimIndent(),
        )
        assertEquals(1, result.dictionary.version)
        assertEquals(listOf("gokus_family", "gokus_family_2"), result.dictionary.categories.map { it.id })
    }

    @Test
    fun `drops entries without names or with a duplicate id, and counts them`() {
        val result = DictionaryFormat.parse(
            """
            { "categories": [
              { "id": "a", "en": "A", "jp": "エー" },
              { "id": "a", "en": "Again", "jp": "再" },
              { "id": "b", "en": "  ", "jp": "ビー" },
              { "id": "c", "en": "C" },
              "not an object"
            ] }
            """.trimIndent(),
        )
        assertEquals(listOf("a"), result.dictionary.categories.map { it.id })
        assertEquals(4, result.dropped)
    }

    @Test
    fun `trims names and removes blank or duplicate aliases`() {
        val clean = DictionaryFormat.sanitize(Category(" x ", " Super Saiyan 3 ", " 超サイヤ人3 ", listOf("SSJ3", " ssj3 ", "", "ss3")))
        assertEquals(Category("x", "Super Saiyan 3", "超サイヤ人3", listOf("SSJ3", "ss3")), clean)
    }

    @Test
    fun `rejects text that is not a dictionary`() {
        assertThrows(Exception::class.java) { DictionaryFormat.parse("not json") }
        assertThrows(IllegalArgumentException::class.java) { DictionaryFormat.parse("""{ "version": 1 }""") }
    }

    @Test
    fun `merge updates by id, then by english name keeping the old id, and appends the rest`() {
        val current = listOf(
            Category("pure", "Pure Saiyans", "純粋サイヤ人"),
            Category("hybrid", "Hybrid Saiyans", "混血サイヤ人"),
        )
        val imported = listOf(
            Category("pure", "Pure Saiyans", "純粋サイヤ人", listOf("ps")),
            Category("hybrid_saiyans", "hybrid saiyans", "混血サイヤ人（新）"),
            Category("ssj3", "Super Saiyan 3", "超サイヤ人3"),
        )
        val merged = DictionaryFormat.merge(current, imported)
        assertEquals(listOf("pure", "hybrid", "ssj3"), merged.map { it.id })
        assertEquals(listOf("ps"), merged[0].aliases)
        assertEquals("混血サイヤ人（新）", merged[1].jp)
    }

    @Test
    fun `reads the game id, and ignores a bad one without dropping the entry`() {
        val result = DictionaryFormat.parse(
            """
            [
              { "id": "a", "gameId": 17, "en": "A", "jp": "エー" },
              { "id": "b", "gameId": "12", "en": "B", "jp": "ビー" },
              { "id": "c", "gameId": null, "en": "C", "jp": "シー" },
              { "id": "d", "gameId": 0, "en": "D", "jp": "ディー" },
              { "id": "e", "gameId": -3, "en": "E", "jp": "イー" },
              { "id": "f", "gameId": 1.5, "en": "F", "jp": "エフ" },
              { "id": "g", "gameId": "x", "en": "G", "jp": "ジー" },
              { "id": "h", "gameId": { "n": 1 }, "en": "H", "jp": "エイチ" },
              { "id": "i", "en": "I", "jp": "アイ" }
            ]
            """.trimIndent(),
        )
        assertEquals(0, result.dropped)
        assertEquals(
            listOf(17, 12, null, null, null, null, null, null, null),
            result.dictionary.categories.map { it.gameId },
        )
    }

    @Test
    fun `encode writes the game id only when there is one`() {
        val text = DictionaryFormat.encode(
            CategoryDictionary(
                version = 3,
                categories = listOf(
                    Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure"), gameId = 17),
                    Category("mine", "Mine", "私の"),
                ),
            ),
        )
        assertTrue(text.contains("\"gameId\": 17"))
        assertEquals(1, Regex("gameId").findAll(text).count())
        assertFalse(text.contains("null"))
    }

    @Test
    fun `sanitize keeps a positive game id only`() {
        assertEquals(17, DictionaryFormat.sanitize(Category("a", "A", "エー", gameId = 17))?.gameId)
        assertNull(DictionaryFormat.sanitize(Category("a", "A", "エー", gameId = 0))?.gameId)
        assertNull(DictionaryFormat.sanitize(Category("a", "A", "エー", gameId = -1))?.gameId)
    }

    @Test
    fun `merge matches by game id after the id, and keeps the old game id when the file has none`() {
        val current = listOf(
            Category("ssj3", "Super Saiyan 3", "超サイヤ人3", gameId = 12),
            Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", gameId = 17),
        )
        val imported = listOf(
            // Same game id, different id and English name: updates the entry, keeps its id
            Category("super_saiyan_three", "Super Saiyan Three", "超サイヤ人3", listOf("s3"), gameId = 12),
            // An export from before game ids: same id, no game id
            Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure")),
        )
        val merged = DictionaryFormat.merge(current, imported)
        assertEquals(listOf("ssj3", "pure_saiyans"), merged.map { it.id })
        assertEquals("Super Saiyan Three", merged[0].en)
        assertEquals(listOf(12, 17), merged.map { it.gameId })
        assertEquals(listOf("pure"), merged[1].aliases)
    }

    @Test
    fun `merge never moves an entry to another game id, nor gives one a game id another entry has`() {
        val current = listOf(
            Category("ssj3", "Super Saiyan 3", "超サイヤ人3", gameId = 12),
            Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", gameId = 17),
            Category("mine", "Mine", "私の"),
            Category("other", "Other", "他の"),
        )
        val imported = listOf(
            // Same id, another game id (a hand-made file): the entry keeps 12
            Category("ssj3", "Super Saiyan 3", "超サイヤ人3", listOf("s3"), gameId = 99),
            // A hand-made entry takes a game id nobody has
            Category("mine", "Mine", "私の", gameId = 50),
            // ...but not one that another entry already has
            Category("other", "Other", "他の", gameId = 17),
        )
        val merged = DictionaryFormat.merge(current, imported)
        assertEquals(listOf("ssj3", "pure_saiyans", "mine", "other"), merged.map { it.id })
        assertEquals(listOf(12, 17, 50, null), merged.map { it.gameId })
        assertEquals(listOf("s3"), merged[0].aliases)
    }

    @Test
    fun `the bundled dictionary is complete and clean`() {
        // Unit tests run from the module directory
        val result = DictionaryFormat.parse(java.io.File("src/main/assets/categories.json").readText())
        val categories = result.dictionary.categories
        assertEquals(0, result.dropped)
        assertTrue(result.dictionary.version >= 3)
        assertTrue(categories.size >= 99)
        assertEquals(categories.size, categories.map { it.jp }.toSet().size)
        // Every entry comes from the game data: a game id, all different
        assertEquals(categories.size, categories.mapNotNull { it.gameId }.toSet().size)
        assertEquals(
            Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure", "saiyan", "ps"), gameId = 17),
            categories.first { it.id == "pure_saiyans" },
        )
        assertEquals("混血サイヤ人", categories.first { it.id == "hybrid_saiyans" }.jp)
    }

    @Test
    fun `encode and parse round trip`() {
        val dictionary = CategoryDictionary(
            version = 3,
            categories = listOf(
                Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure"), gameId = 17),
                Category("mine", "Mine", "私の"),
            ),
        )
        assertEquals(dictionary, DictionaryFormat.parse(DictionaryFormat.encode(dictionary)).dictionary)
    }
}
