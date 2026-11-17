package it.emanuelemelini.dokkants.categoryhelper.update

import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the automatic "Update categories" runs, and what it keeps and announces of a result. */
class AutoUpdatePolicyTest {

    private val minute = 60_000L
    private val hour = 60 * minute
    private val last = 1_800_000_000_000L

    private fun due(elapsedMs: Long, failed: Boolean = false, enabled: Boolean = true) =
        AutoUpdatePolicy.due(nowMs = last + elapsedMs, lastAttemptMs = last, lastAttemptFailed = failed, enabled = enabled)

    @Test
    fun `the intervals are a day and an hour`() {
        assertEquals(24 * hour, AutoUpdatePolicy.INTERVAL_MS)
        assertEquals(hour, AutoUpdatePolicy.RETRY_AFTER_FAILURE_MS)
    }

    @Test
    fun `the first opening checks`() {
        assertTrue(AutoUpdatePolicy.due(nowMs = last, lastAttemptMs = null, lastAttemptFailed = false, enabled = true))
    }

    @Test
    fun `a successful check waits a full day`() {
        assertFalse(due(0))
        assertFalse(due(hour))
        assertFalse(due(23 * hour))
        assertFalse(due(24 * hour - 1))
        assertTrue(due(24 * hour))
        assertTrue(due(72 * hour))
    }

    @Test
    fun `a failed check is retried after an hour`() {
        assertFalse(due(0, failed = true))
        assertFalse(due(59 * minute, failed = true))
        assertFalse(due(hour - 1, failed = true))
        assertTrue(due(60 * minute, failed = true))
        assertTrue(due(23 * hour, failed = true))
        // Not a failure: the hour is not enough
        assertFalse(due(60 * minute, failed = false))
    }

    @Test
    fun `turned off, it never checks`() {
        assertFalse(AutoUpdatePolicy.due(nowMs = last, lastAttemptMs = null, lastAttemptFailed = false, enabled = false))
        assertFalse(due(24 * hour, enabled = false))
        assertFalse(due(hour, failed = true, enabled = false))
        assertFalse(due(-hour, enabled = false))
    }

    @Test
    fun `a clock moved back checks instead of waiting`() {
        assertTrue(due(-1))
        assertTrue(due(-hour))
        assertTrue(due(-30 * 24 * hour, failed = true))
    }

    @Test
    fun `only added categories are announced`() {
        val two = listOf(Category(id = "a", en = "A", jp = "エー"), Category(id = "b", en = "B", jp = "ビー"))
        val added = AutoUpdatePolicy.outcome(UpdateResult.Added(two))
        assertEquals(AutoUpdatePolicy.Outcome(failed = false, added = 2), added)
        assertTrue(added.announce)

        val upToDate = AutoUpdatePolicy.outcome(UpdateResult.UpToDate)
        assertEquals(AutoUpdatePolicy.Outcome(failed = false, added = 0), upToDate)
        assertFalse(upToDate.announce)

        for (reason in UpdateResult.Reason.entries) {
            val failed = AutoUpdatePolicy.outcome(UpdateResult.Failed(reason, httpCode = 503))
            assertEquals(AutoUpdatePolicy.Outcome(failed = true, added = 0), failed)
            assertFalse(failed.announce)
        }
    }

    @Test
    fun `an attempt that never finishes counts as failed`() {
        val unfinished = AutoUpdatePolicy.UNFINISHED
        assertTrue(unfinished.failed)
        assertFalse(unfinished.announce)
        assertFalse(due(59 * minute, failed = unfinished.failed))
        assertTrue(due(hour, failed = unfinished.failed))
    }
}
