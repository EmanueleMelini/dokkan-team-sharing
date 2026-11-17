package it.emanuelemelini.dokkants.categoryhelper.update

/**
 * When the automatic "Check for updates" runs, and what it keeps of the result. Pure: the
 * accessibility service asks [due] each time the monitored app comes to the front, so the check
 * happens at most once a day and only while the user is playing (no scheduler, no wake-ups).
 */
object AutoUpdatePolicy {

    private const val HOUR_MS = 60L * 60 * 1000

    /** A successful check is enough for a day. */
    const val INTERVAL_MS = 24 * HOUR_MS

    /** A failed check (no connection, server error) is tried again after an hour, at the next opening. */
    const val RETRY_AFTER_FAILURE_MS = HOUR_MS

    /**
     * True when an automatic check should start now: it is [enabled] and there was no attempt yet,
     * or the last one is a day old, or it failed an hour ago or more. A last attempt in the future
     * means the clock moved back: check, rather than wait for the clock to catch up.
     */
    fun due(nowMs: Long, lastAttemptMs: Long?, lastAttemptFailed: Boolean, enabled: Boolean): Boolean {
        if (!enabled) return false
        if (lastAttemptMs == null || nowMs < lastAttemptMs) return true
        val elapsed = nowMs - lastAttemptMs
        return elapsed >= INTERVAL_MS || (lastAttemptFailed && elapsed >= RETRY_AFTER_FAILURE_MS)
    }

    /** What an automatic check stores: whether it failed and how many categories it added. */
    data class Outcome(val failed: Boolean, val added: Int) {
        /** Only new categories are worth a message: an up-to-date or failed check stays silent. */
        val announce: Boolean get() = added > 0
    }

    /** Kept until the attempt finishes: a check that never completes counts as failed (retried in an hour). */
    val UNFINISHED = Outcome(failed = true, added = 0)

    fun outcome(result: UpdateResult): Outcome = when (result) {
        is UpdateResult.Added -> Outcome(failed = false, added = result.categories.size)
        UpdateResult.UpToDate -> Outcome(failed = false, added = 0)
        is UpdateResult.Failed -> Outcome(failed = true, added = 0)
    }
}
