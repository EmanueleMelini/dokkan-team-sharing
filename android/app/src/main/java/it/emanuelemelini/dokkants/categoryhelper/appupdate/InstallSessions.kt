package it.emanuelemelini.dokkants.categoryhelper.appupdate

/**
 * Which install session belongs to the current attempt, so that a late answer about an earlier one
 * cannot change the dialogs. Abandoning a session makes the installer answer ABORTED for it (a new
 * attempt abandons the old sessions, Cancel abandons its own), and a cancelled download can still
 * fail on its abandoned session. Pure and thread-safe: the session is created on the IO dispatcher,
 * the installer answers on the main thread.
 */
class InstallSessions {

    private var attempt = 0
    private var active = NONE

    /** A new attempt (Update): the sessions of every earlier one stop counting. Returns its token. */
    @Synchronized
    fun begin(): Int {
        attempt++
        active = NONE
        return attempt
    }

    /** The session of [attempt] was created; false when that attempt was cancelled or replaced meanwhile. */
    @Synchronized
    fun created(attempt: Int, sessionId: Int): Boolean {
        if (attempt != this.attempt) return false
        active = sessionId
        return true
    }

    /** [attempt] is still the current one: its progress and its errors may change the dialogs. */
    @Synchronized
    fun isCurrent(attempt: Int): Boolean = attempt == this.attempt

    /** Cancel: no attempt is current any more. Returns the session to abandon, if one was created. */
    @Synchronized
    fun cancel(): Int? {
        attempt++
        val session = active
        active = NONE
        return session.takeIf { it != NONE }
    }

    /**
     * The installer answered about [sessionId]: true when it is the current attempt's session (a
     * session of a stopped process is not: nobody waits for it). An answer that [ends] the session,
     * anything but the request to confirm, makes the next ones about it stale.
     */
    @Synchronized
    fun accept(sessionId: Int, ends: Boolean): Boolean {
        if (sessionId == NONE || sessionId != active) return false
        if (ends) active = NONE
        return true
    }

    companion object {
        /** No session: PackageInstaller never gives out a negative id. */
        const val NONE = -1
    }
}
