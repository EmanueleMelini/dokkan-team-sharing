package it.emanuelemelini.dokkants.categoryhelper.appupdate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the app looks for a new version of itself, and when a known one is offered. */
class AppUpdatePolicyTest {

    private val minute = 60_000L
    private val hour = 60 * minute
    private val last = 1_800_000_000_000L

    private fun v(text: String) = requireNotNull(AppVersion.parse(text))

    private fun due(elapsedMs: Long, failed: Boolean = false, enabled: Boolean = true, release: Boolean = true) =
        AppUpdatePolicy.due(last + elapsedMs, last, failed, enabled, releaseBuild = release)

    private val release = AppRelease(
        version = v("1.3.0"),
        notes = ReleaseNotes.EMPTY,
        apkUrl = "${ApkUrls.DOWNLOAD_PREFIX}category-helper-v1.3.0/dokkants-category-helper.apk",
        apkSize = 1,
        pageUrl = GitHubReleases.RELEASES_PAGE,
    )

    @Test
    fun `release builds check once a day, an hour after a failure, like the categories`() {
        assertTrue(AppUpdatePolicy.due(last, null, false, enabled = true, releaseBuild = true))
        assertFalse(due(23 * hour))
        assertTrue(due(24 * hour))
        assertFalse(due(59 * minute, failed = true))
        assertTrue(due(hour, failed = true))
        // Clock moved back
        assertTrue(due(-hour))
    }

    @Test
    fun `never with the switch off, never in a debug build`() {
        assertFalse(due(48 * hour, enabled = false))
        assertFalse(AppUpdatePolicy.due(last, null, false, enabled = true, releaseBuild = false))
        assertFalse(due(48 * hour, release = false))
    }

    @Test
    fun `newer means a higher version than the installed one, or none installed`() {
        assertTrue(AppUpdatePolicy.isNewer(v("1.3.0"), v("1.2.0")))
        assertFalse(AppUpdatePolicy.isNewer(v("1.2.0"), v("1.2.0")))
        assertFalse(AppUpdatePolicy.isNewer(v("1.1.0"), v("1.2.0")))
        // The debug build without the release app installed
        assertTrue(AppUpdatePolicy.isNewer(v("1.1.0"), null))
    }

    @Test
    fun `Later holds for a day`() {
        val until = AppUpdatePolicy.laterUntil(last)
        assertEquals(last + 24 * hour, until)
        assertTrue(AppUpdatePolicy.snoozed(last, until))
        assertTrue(AppUpdatePolicy.snoozed(last + 24 * hour - 1, until))
        assertFalse(AppUpdatePolicy.snoozed(last + 24 * hour, until))
        assertFalse(AppUpdatePolicy.snoozed(last, null))
        // The clock moved back by more than the day: it no longer holds
        assertFalse(AppUpdatePolicy.snoozed(last - minute, until))
    }

    @Test
    fun `the offered release is newer and not put off`() {
        assertEquals(release, AppUpdatePolicy.offered(release, v("1.2.0"), last, null))
        assertNull(AppUpdatePolicy.offered(release, v("1.3.0"), last, null))
        assertNull(AppUpdatePolicy.offered(release, v("1.2.0"), last, AppUpdatePolicy.laterUntil(last)))
        assertEquals(release, AppUpdatePolicy.offered(release, v("1.2.0"), last + 24 * hour, AppUpdatePolicy.laterUntil(last)))
        assertNull(AppUpdatePolicy.offered(null, v("1.2.0"), last, null))
    }

    @Test
    fun `Later puts off only the dialog, the dot and the row stay until the update is installed`() {
        val later = AppUpdatePolicy.laterUntil(last)
        assertNull(AppUpdatePolicy.offered(release, v("1.2.0"), last, later))
        assertEquals(release, AppUpdatePolicy.available(release, v("1.2.0")))
        assertEquals(release, AppUpdatePolicy.available(release, null))
        assertNull(AppUpdatePolicy.available(release, v("1.3.0")))
        assertNull(AppUpdatePolicy.available(release, release.version))
        assertNull(AppUpdatePolicy.available(null, v("1.2.0")))
    }
}
