package it.emanuelemelini.dokkants.categoryhelper.appupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppVersionTest {

    private fun v(text: String) = requireNotNull(AppVersion.parse(text)) { text }

    @Test
    fun `versions compare part by part, as numbers`() {
        assertTrue(v("1.2.0") > v("1.1.0"))
        assertTrue(v("1.10.0") > v("1.9.9"))
        assertTrue(v("2.0.0") > v("1.99.99"))
        assertTrue(v("1.2.1") > v("1.2.0"))
        assertEquals(v("1.2"), v("1.2.0"))
        assertEquals(v("1.2").hashCode(), v("1.2.0").hashCode())
    }

    @Test
    fun `the debug suffix and build metadata are ignored`() {
        assertEquals(v("1.2.0"), v("1.2.0-debug"))
        assertEquals(v("1.2.0"), v("1.2.0+abc"))
        assertEquals("1.2.0", v("1.2.0-debug").toString())
        assertEquals("1.2.0", v("1.2").toString())
    }

    @Test
    fun `text that is not a version is null`() {
        for (text in listOf("", "v1.2.0", "category-helper-v1.2.0", "1.2.0.1", "1..2", "a.b.c", "-1.0.0", "1.2.x", "?")) {
            assertNull(text, AppVersion.parse(text))
        }
    }
}
