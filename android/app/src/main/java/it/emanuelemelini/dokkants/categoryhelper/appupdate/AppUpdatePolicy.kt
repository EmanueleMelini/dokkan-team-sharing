package it.emanuelemelini.dokkants.categoryhelper.appupdate

import it.emanuelemelini.dokkants.categoryhelper.update.AutoUpdatePolicy

/**
 * When the app looks for a new version of itself, and when a known one is offered. Pure, like
 * [AutoUpdatePolicy], whose day and hour it shares: the automatic check runs at most once a day (an
 * hour after a check that failed), from the same triggers as the categories check, and only in
 * release builds.
 */
object AppUpdatePolicy {

    /** "Later": the same version is offered again after a day. */
    const val LATER_MS = AutoUpdatePolicy.INTERVAL_MS

    /**
     * True when an automatic check should start now: in a [releaseBuild] (a debug build cannot
     * update itself from GitHub), with the switch [enabled], by the rule of [AutoUpdatePolicy.due].
     */
    fun due(nowMs: Long, lastCheckMs: Long?, lastCheckFailed: Boolean, enabled: Boolean, releaseBuild: Boolean): Boolean =
        releaseBuild && AutoUpdatePolicy.due(nowMs, lastCheckMs, lastCheckFailed, enabled)

    /**
     * [latest] can be installed over [installed], the version of the target app on the phone: the app
     * itself in a release build, the release app in a debug build, null when that is not installed.
     */
    fun isNewer(latest: AppVersion, installed: AppVersion?): Boolean = installed == null || latest > installed

    /** "Later" still holds. A date more than a day ahead means the clock moved back: it no longer holds. */
    fun snoozed(nowMs: Long, laterUntilMs: Long?): Boolean =
        laterUntilMs != null && nowMs < laterUntilMs && laterUntilMs - nowMs <= LATER_MS

    /**
     * A known release newer than the installed one, "Later" or not: the bubble's dot, the panel's
     * row and the settings line stay until it is installed (owner's choice, 2026-11-17: they are
     * quiet reminders; "Later" only puts off the dialog that opens by itself).
     */
    fun available(latest: AppRelease?, installed: AppVersion?): AppRelease? =
        latest?.takeIf { isNewer(it.version, installed) }

    /** The release whose dialog opens by itself now (at app start, after an automatic check), or null: not while "Later" holds. */
    fun offered(latest: AppRelease?, installed: AppVersion?, nowMs: Long, laterUntilMs: Long?): AppRelease? =
        available(latest, installed)?.takeIf { !snoozed(nowMs, laterUntilMs) }

    fun laterUntil(nowMs: Long): Long = nowMs + LATER_MS
}
