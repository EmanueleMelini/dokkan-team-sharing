package it.emanuelemelini.dokkants.categoryhelper.update

import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryFormat
import it.emanuelemelini.dokkants.categoryhelper.update.CategoryUpdates.RemoteCategory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CategoryUpdatesTest {

    /** The shape of GET /api/v1/categories (the contract), trimmed. */
    private val sample = """
        {"version":1,"categories":[
          {"id":1,"name_en":"Fusion","name_ja":"フュージョン","aliases":[]},
          {"id":12,"name_en":"Super Saiyan 3","name_ja":"超サイヤ人3","aliases":["ss3","ssj3"]},
          {"id":17,"name_en":"Pure Saiyans","name_ja":"純粋サイヤ人","aliases":["ps","pure","saiyan"]},
          {"id":100,"name_en":"Brand New Category","name_ja":"新しいカテゴリ","aliases":["bnc"]},
          {"id":101,"name_en":"Not Translated Yet","name_ja":null,"aliases":["nty"]}
        ]}
    """.trimIndent()

    @Test
    fun `parses the contract payload`() {
        val payload = CategoryUpdates.parse(sample)
        assertEquals(1, payload.version)
        assertEquals(0, payload.skipped)
        assertEquals(listOf(1, 12, 17, 100, 101), payload.categories.map { it.gameId })
        assertEquals(RemoteCategory(12, "Super Saiyan 3", "超サイヤ人3", listOf("ss3", "ssj3")), payload.categories[1])
        assertEquals(null, payload.categories[4].jp)
    }

    @Test
    fun `ignores unknown fields and skips bad entries, counting them`() {
        val payload = CategoryUpdates.parse(
            """
            {"version":1,"generated":"x","categories":[
              {"id":1,"name_en":"Fusion","name_ja":"フュージョン","aliases":[],"kind":"new"},
              {"id":"2","name_en":"String id","name_ja":"文字"},
              {"id":0,"name_en":"Zero","name_ja":"ゼロ"},
              {"id":3,"name_en":"  ","name_ja":"空"},
              {"id":4,"name_ja":"英語なし"},
              {"id":1,"name_en":"Fusion again","name_ja":"再"},
              {"id":5,"name_en":" Trimmed ","name_ja":" ","aliases":["a",7,null," b "]},
              "not an object"
            ]}
            """.trimIndent(),
        )
        assertEquals(listOf(1, 5), payload.categories.map { it.gameId })
        assertEquals(6, payload.skipped)
        assertEquals(RemoteCategory(5, "Trimmed", null, listOf("a", "b")), payload.categories[1])
    }

    @Test
    fun `rejects what is not the contract`() {
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("<html>nope</html>") }
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("[]") }
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("""{"categories":[]}""") }
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("""{"version":"1","categories":[]}""") }
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("""{"version":1}""") }
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("""{"version":1,"categories":[]}""") }
        assertThrows(IllegalArgumentException::class.java) { CategoryUpdates.parse("""{"version":0,"categories":[{"id":1,"name_en":"A","name_ja":"エー"}]}""") }
    }

    @Test
    fun `a newer payload version asks for a newer app`() {
        val error = assertThrows(CategoryUpdates.NewerFormatException::class.java) {
            CategoryUpdates.parse("""{"version":2,"categories":[{"id":1,"name_en":"Fusion","name_ja":"フュージョン"}]}""")
        }
        assertEquals(2, error.version)
    }

    @Test
    fun `adds only the categories that are new, with a Japanese name`() {
        val local = listOf(
            Category("fusion", "Fusion", "フュージョン", gameId = 1),
            Category("super_saiyan_3", "Super Saiyan 3", "超サイヤ人3", listOf("ssj3", "ss3"), gameId = 12),
            Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure", "saiyan", "ps"), gameId = 17),
        )
        val added = CategoryUpdates.newCategories(local, CategoryUpdates.parse(sample).categories)
        assertEquals(listOf(Category("brand_new_category", "Brand New Category", "新しいカテゴリ", listOf("bnc"), gameId = 100)), added)
    }

    @Test
    fun `a local entry with the same game id is kept as it is, even when edited`() {
        val edited = Category("my_ssj3", "SSJ3 (mine)", "超サイヤ人３", listOf("three"), gameId = 12)
        val remote = listOf(RemoteCategory(12, "Super Saiyan 3", "超サイヤ人3", listOf("ss3")))
        assertEquals(emptyList<Category>(), CategoryUpdates.newCategories(listOf(edited), remote))
    }

    @Test
    fun `a hand-made entry matches by English or Japanese name, and is not changed`() {
        val local = listOf(
            // Same English name, different case and punctuation
            Category("pure", "pure saiyans!", "純粋", emptyList()),
            // Community English name, official Japanese name: arrives later in Global under another name
            Category("new_one", "Community Name", "新しいカテゴリ", emptyList()),
        )
        val remote = listOf(
            RemoteCategory(17, "Pure Saiyans", "純粋サイヤ人", listOf("ps")),
            RemoteCategory(100, "Brand New Category", "新しいカテゴリ", listOf("bnc")),
            RemoteCategory(8, "Realm of Gods", "神次元", listOf("rog")),
        )
        val added = CategoryUpdates.newCategories(local, remote)
        assertEquals(listOf(8), added.map { it.gameId })
        // The local entries are not part of the result: the caller only appends
        assertTrue(added.none { it.id == "pure" || it.id == "new_one" })
    }

    @Test
    fun `an entry with a game id does not match by name`() {
        // Only entries without a game id fall back to names: another game id is another category
        val local = listOf(Category("giant_form", "Giant Form", "巨大化", gameId = 13))
        val remote = listOf(RemoteCategory(130, "Giant Form", "巨大化（新）", emptyList()))
        assertEquals(listOf("giant_form_2"), CategoryUpdates.newCategories(local, remote).map { it.id })
    }

    @Test
    fun `new ids are slugs that no entry uses, also within the same check`() {
        val local = listOf(Category("brand_new_category", "Something Else", "別", gameId = 50))
        val remote = listOf(
            RemoteCategory(100, "Brand New Category", "新しいカテゴリ", emptyList()),
            RemoteCategory(101, "Brand-New Category", "新しいカテゴリ２", emptyList()),
        )
        assertEquals(
            listOf("brand_new_category_2", "brand_new_category_3"),
            CategoryUpdates.newCategories(local, remote).map { it.id },
        )
    }

    @Test
    fun `aliases are cleaned like the editor does`() {
        val remote = listOf(RemoteCategory(100, "Brand New Category", "新しいカテゴリ", listOf("bnc", "BNC", " ", "new")))
        assertEquals(listOf("bnc", "new"), CategoryUpdates.newCategories(emptyList(), remote).single().aliases)
    }

    @Test
    fun `a second check adds nothing`() {
        val local = listOf(Category("fusion", "Fusion", "フュージョン", gameId = 1))
        val remote = CategoryUpdates.parse(sample).categories
        val first = CategoryUpdates.newCategories(local, remote)
        assertEquals(listOf(12, 17, 100), first.map { it.gameId })
        assertEquals(emptyList<Category>(), CategoryUpdates.newCategories(local + first, remote))
    }

    @Test
    fun `the bundled dictionary already has every category of a payload made from it`() {
        val bundled = DictionaryFormat.parse(java.io.File("src/main/assets/categories.json").readText()).dictionary.categories
        val payload = bundled.map { RemoteCategory(it.gameId!!, it.en, it.jp, it.aliases.sorted()) }
        assertEquals(emptyList<Category>(), CategoryUpdates.newCategories(bundled, payload))
    }
}
