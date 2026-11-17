package it.emanuelemelini.dokkants.categoryhelper.search

import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CategorySearchTest {

    private val pure = Category("pure_saiyans", "Pure Saiyans", "純粋サイヤ人", listOf("pure", "saiyan"))
    private val hybrid = Category("hybrid_saiyans", "Hybrid Saiyans", "混血サイヤ人", listOf("hybrid", "half saiyan"))
    private val ssj3 = Category("ssj3", "Super Saiyan 3", "超サイヤ人3", listOf("ssj3"))
    private val gokuFamily = Category("goku_family", "Goku's Family", "孫悟空の家系")
    private val superSaiyans = Category("super_saiyans", "Super Saiyans", "超サイヤ人")
    private val all = listOf(pure, hybrid, ssj3, gokuFamily, superSaiyans)

    private fun ids(query: String) = CategorySearch.search(query, all).map { it.id }

    @Test
    fun `normalize lowercases, folds width, drops apostrophes and collapses punctuation`() {
        assertEquals("pure saiyans", CategorySearch.normalize("  Pure-Saiyans!! "))
        assertEquals("gokus family", CategorySearch.normalize("Goku's   Family"))
        assertEquals("ssj3", CategorySearch.normalize("ＳＳＪ３"))
        assertEquals("", CategorySearch.normalize(" .,! "))
    }

    @Test
    fun `blank query finds nothing`() {
        assertTrue(ids("  ").isEmpty())
    }

    @Test
    fun `exact beats prefix beats word prefix`() {
        // "super saiyans" exact, "super saiyan 3" prefix
        assertEquals(listOf("super_saiyans", "ssj3"), ids("super saiyans").take(2))
        // prefix on the English name first, then the word-prefix matches
        assertEquals("pure_saiyans", ids("pure").first())
        assertEquals("hybrid_saiyans", ids("hyb").single())
    }

    @Test
    fun `word prefix finds names that do not start with the query`() {
        val result = ids("saiyans")
        assertTrue(result.containsAll(listOf("pure_saiyans", "hybrid_saiyans", "super_saiyans")))
    }

    @Test
    fun `aliases match`() {
        assertEquals("hybrid_saiyans", ids("half saiyan").first())
        assertEquals("ssj3", ids("ssj3").first())
    }

    @Test
    fun `apostrophes and missing spaces do not matter`() {
        assertEquals("goku_family", ids("gokus fam").first())
        assertEquals("pure_saiyans", ids("puresaiyans").first())
    }

    @Test
    fun `words in any order`() {
        assertEquals("pure_saiyans", ids("saiyans pure").first())
    }

    @Test
    fun `typos are tolerated`() {
        assertEquals("hybrid_saiyans", ids("hybird").first())
        assertTrue(ids("sayans").contains("pure_saiyans"))
    }

    @Test
    fun `unrelated text finds nothing`() {
        assertTrue(ids("zzzz").isEmpty())
    }

    @Test
    fun `japanese query matches the japanese name`() {
        assertEquals("hybrid_saiyans", ids("混血").single())
    }

    @Test
    fun `edit distance counts adjacent swaps as one`() {
        assertEquals(1, CategorySearch.editDistance("hybird", "hybrid"))
        assertEquals(1, CategorySearch.editDistance("sayan", "saiyan"))
    }
}
