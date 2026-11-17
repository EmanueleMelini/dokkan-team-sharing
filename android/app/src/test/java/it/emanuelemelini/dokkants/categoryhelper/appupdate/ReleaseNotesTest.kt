package it.emanuelemelini.dokkants.categoryhelper.appupdate

import it.emanuelemelini.dokkants.categoryhelper.BuildConfig
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The notes files (assets/release-notes/X.Y.Z.md, also the GitHub release body) and the language picked. */
class ReleaseNotesTest {

    /** The format of the notes files: an intro line, English bullets, the hidden Italian block. */
    private val file = """
        DokkanTS Category Helper 1.2.0 updates itself.

        - Updates from inside the app.
        - What's new after an update.

        <!-- dch-notes:it
        - Aggiornamenti dall'app.
        - Le novità dopo un aggiornamento.
        -->
    """.trimIndent()

    @Test
    fun `English bullets are the visible ones, without the intro line or the hidden block`() {
        val notes = ReleaseNotes.parse(file)
        assertEquals(listOf("Updates from inside the app.", "What's new after an update."), notes.forLanguage("en"))
    }

    @Test
    fun `Italian comes from the hidden block`() {
        val notes = ReleaseNotes.parse(file)
        assertEquals(listOf("Aggiornamenti dall'app.", "Le novità dopo un aggiornamento."), notes.forLanguage("it"))
    }

    @Test
    fun `a language without its block falls back to English`() {
        val englishOnly = ReleaseNotes.parse(file.substringBefore("<!--"))
        assertEquals("Updates from inside the app.", englishOnly.forLanguage("it").first())
        assertEquals("Updates from inside the app.", ReleaseNotes.parse(file).forLanguage("de").first())
    }

    @Test
    fun `a body edited on GitHub (CRLF) reads the same`() {
        assertEquals(ReleaseNotes.parse(file), ReleaseNotes.parse(file.replace("\n", "\r\n")))
    }

    @Test
    fun `the published 1_0_0 body has English notes only`() {
        val body = "First public release of DokkanTS Category Helper, an Android helper for Dokkan Battle JP.\n\n" +
            "- Type a category name in English.\n- Comes with the 99 categories of the game, with short aliases.\n"
        val notes = ReleaseNotes.parse(body)
        assertEquals(2, notes.forLanguage("en").size)
        assertEquals(notes.forLanguage("en"), notes.forLanguage("it"))
    }

    @Test
    fun `other comments and an unclosed one stay hidden`() {
        val text = "- One\n<!-- a note for the maintainer\n- not a note\n-->\n- Two\n<!-- unclosed\n- hidden too"
        assertEquals(listOf("One", "Two"), ReleaseNotes.parse(text).forLanguage("en"))
    }

    @Test
    fun `a body without bullets has no notes`() {
        val notes = ReleaseNotes.parse("**Full Changelog**: https://github.com/x/compare/a...b")
        assertTrue(notes.isEmpty)
        assertTrue(notes.forLanguage("it").isEmpty())
    }

    @Test
    fun `format writes a notes file that parses back the same`() {
        val notes = ReleaseNotes.parse(file)
        val formatted = notes.format()
        assertEquals(notes, ReleaseNotes.parse(formatted))
        assertTrue(formatted, formatted.contains("<!-- dch-notes:it\n- Aggiornamenti dall'app.\n"))
        assertEquals(ReleaseNotes.EMPTY, ReleaseNotes.parse(ReleaseNotes.EMPTY.format()))
    }

    @Test
    fun `a bullet cannot open or close a comment of the formatted text`() {
        val tricky = ReleaseNotes(mapOf("en" to listOf("a --> b", "c <!-- d"), "it" to listOf("e --> f")))
        val back = ReleaseNotes.parse(tricky.format())
        assertEquals(listOf("a -> b", "c <!- d"), back.forLanguage("en"))
        assertEquals(listOf("e -> f"), back.forLanguage("it"))
    }

    @Test
    fun `a bullet stays safe also when one pass would leave a comment marker`() {
        for (bullet in listOf("a <!--- b", "a ---> b", "<!-<!---->>", "------>", "<!--<!--<!--")) {
            val safe = ReleaseNotes.safe(bullet)
            assertTrue(safe, "<!--" !in safe && "-->" !in safe)
        }
        assertEquals("plain - text -> here", ReleaseNotes.safe("plain - text -> here"))
        val tricky = ReleaseNotes(mapOf("en" to listOf("a ---> b"), "it" to listOf("c <!--- d")))
        val back = ReleaseNotes.parse(tricky.format())
        assertEquals(listOf("a -> b"), back.forLanguage("en"))
        assertEquals(listOf("c <!- d"), back.forLanguage("it"))
    }

    @Test
    fun `a body that is not ours cannot grow without bounds`() {
        val many = (1..100).joinToString("\n") { "- " + "x".repeat(2_000) }
        val bullets = ReleaseNotes.parse(many).forLanguage("en")
        assertEquals(ReleaseNotes.MAX_BULLETS, bullets.size)
        assertTrue(bullets.all { it.length == ReleaseNotes.MAX_BULLET_CHARS })
    }

    @Test
    fun `every bundled notes file has the same bullets in English and Italian, and this version has one`() {
        val files = File("src/main/assets/release-notes").listFiles().orEmpty().filter { it.name.endsWith(".md") }
        val versions = files.map { requireNotNull(AppVersion.parse(it.name.removeSuffix(".md"))) { it.name } }
        assertTrue("$versions", AppVersion.parse(BuildConfig.VERSION_NAME) in versions)
        for (file in files) {
            val notes = ReleaseNotes.parse(file.readText())
            val english = notes.bullets[ReleaseNotes.ENGLISH].orEmpty()
            val italian = notes.bullets["it"].orEmpty()
            assertTrue(file.name, english.isNotEmpty())
            assertEquals(file.name, english.size, italian.size)
            assertTrue(file.name, english.none { it in italian })
        }
    }
}
