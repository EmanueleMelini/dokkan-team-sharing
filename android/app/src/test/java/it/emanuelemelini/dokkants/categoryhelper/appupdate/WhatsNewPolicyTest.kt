package it.emanuelemelini.dokkants.categoryhelper.appupdate

import org.junit.Assert.assertEquals
import org.junit.Test

/** Which notes "What's new" shows at the first start after an update. */
class WhatsNewPolicyTest {

    private fun v(text: String) = requireNotNull(AppVersion.parse(text))

    private val bundled = listOf(v("1.0.0"), v("1.1.0"), v("1.2.0"), v("1.3.0"), v("1.4.0"))

    private fun pending(seenCode: Int?, seen: String?, fresh: Boolean = false, code: Int = 10, current: String = "1.4.0") =
        WhatsNewPolicy.pending(seenCode, seen?.let(::v), code, v(current), fresh, bundled).map { it.toString() }

    @Test
    fun `a fresh install shows nothing`() {
        assertEquals(emptyList<String>(), pending(seenCode = null, seen = null, fresh = true))
    }

    @Test
    fun `an update from 1_1_0 or older (no record) shows the current notes only`() {
        assertEquals(listOf("1.2.0"), pending(seenCode = null, seen = null, code = 8, current = "1.2.0"))
    }

    @Test
    fun `an update shows every version since the last seen, newest first`() {
        assertEquals(listOf("1.4.0", "1.3.0"), pending(seenCode = 8, seen = "1.2.0"))
        assertEquals(listOf("1.4.0"), pending(seenCode = 9, seen = "1.3.0"))
    }

    @Test
    fun `nothing once seen, or after a downgrade`() {
        assertEquals(emptyList<String>(), pending(seenCode = 10, seen = "1.4.0"))
        assertEquals(emptyList<String>(), pending(seenCode = 11, seen = "1.5.0"))
    }

    @Test
    fun `never notes newer than the installed version, and the current ones when the last seen is unknown`() {
        assertEquals(listOf("1.3.0"), pending(seenCode = 8, seen = "1.2.0", code = 9, current = "1.3.0"))
        assertEquals(listOf("1.3.0"), pending(seenCode = 8, seen = null, code = 9, current = "1.3.0"))
    }

    @Test
    fun `a version without its notes file is simply missing`() {
        val result = WhatsNewPolicy.pending(8, v("1.2.0"), 10, v("1.4.0"), false, listOf(v("1.2.0"), v("1.4.0")))
        assertEquals(listOf(v("1.4.0")), result)
    }
}
