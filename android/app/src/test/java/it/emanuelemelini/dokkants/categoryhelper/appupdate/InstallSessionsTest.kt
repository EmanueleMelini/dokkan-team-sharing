package it.emanuelemelini.dokkants.categoryhelper.appupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which answers of the installer, and which errors of a download, still count. */
class InstallSessionsTest {

    @Test
    fun `the current session asks to confirm, then its final answer ends it`() {
        val sessions = InstallSessions()
        val attempt = sessions.begin()
        assertTrue(sessions.created(attempt, 11))
        assertTrue(sessions.accept(11, ends = false))
        assertTrue(sessions.accept(11, ends = true))
        // A second final answer about the same session is stale
        assertFalse(sessions.accept(11, ends = true))
    }

    @Test
    fun `a new attempt ignores the ABORTED of the session it abandoned`() {
        val sessions = InstallSessions()
        val first = sessions.begin()
        sessions.created(first, 11)
        // The confirmation was left open: the session waits
        assertTrue(sessions.accept(11, ends = false))
        val second = sessions.begin()
        // Abandoned by the new attempt, before or after its session exists
        assertFalse(sessions.accept(11, ends = true))
        assertTrue(sessions.created(second, 22))
        assertFalse(sessions.accept(11, ends = true))
        assertTrue(sessions.accept(22, ends = false))
    }

    @Test
    fun `a cancelled download cannot report its errors or progress, not even over the next attempt`() {
        val sessions = InstallSessions()
        val first = sessions.begin()
        sessions.created(first, 11)
        assertEquals(11, sessions.cancel())
        assertFalse(sessions.isCurrent(first))
        val second = sessions.begin()
        assertFalse(sessions.isCurrent(first))
        assertTrue(sessions.isCurrent(second))
    }

    @Test
    fun `a session created after Cancel is refused`() {
        val sessions = InstallSessions()
        val attempt = sessions.begin()
        assertNull(sessions.cancel())
        assertFalse(sessions.created(attempt, 11))
        assertFalse(sessions.accept(11, ends = false))
    }

    @Test
    fun `Cancel after the commit drops the confirmation that arrives later`() {
        val sessions = InstallSessions()
        val attempt = sessions.begin()
        sessions.created(attempt, 11)
        assertEquals(11, sessions.cancel())
        assertFalse(sessions.accept(11, ends = false))
        assertFalse(sessions.accept(11, ends = true))
    }

    @Test
    fun `an answer without a session id, or about a session of a stopped process, is ignored`() {
        val sessions = InstallSessions()
        assertFalse(sessions.accept(InstallSessions.NONE, ends = true))
        assertFalse(sessions.accept(42, ends = true))
        sessions.created(sessions.begin(), 11)
        assertFalse(sessions.accept(InstallSessions.NONE, ends = false))
    }
}
