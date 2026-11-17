package it.emanuelemelini.dokkants.categoryhelper.appupdate

import android.content.Context
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import it.emanuelemelini.dokkants.categoryhelper.settings.appDataStore
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * What the app knows about its own updates: the latest release seen on GitHub, the last check of
 * the app version (automatic or manual) and how it went, "Later", and the last version whose notes
 * were seen. In the "settings" DataStore, so it travels with the backup like the rest.
 */
data class AppUpdateRecord(
    /** The latest release found by the last successful check; null before, or when there is none. */
    val latest: AppRelease? = null,
    /** When the last check started (epoch ms); null before the first. */
    val checkedAtMs: Long? = null,
    /** The last check failed, or has not finished. */
    val checkFailed: Boolean = false,
    /** "Later" until this time (epoch ms). */
    val laterUntilMs: Long? = null,
)

class AppUpdateStore(context: Context) {
    private val store = context.applicationContext.appDataStore

    private val data: Flow<Preferences> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }

    val record: Flow<AppUpdateRecord> = data.map { prefs ->
        AppUpdateRecord(
            latest = readRelease(prefs),
            checkedAtMs = prefs[CHECKED_AT],
            checkFailed = prefs[CHECK_FAILED] ?: false,
            laterUntilMs = prefs[LATER_UNTIL],
        )
    }.distinctUntilChanged()

    /** Written before going online: until [recordCheckOutcome] the check counts as failed. */
    suspend fun recordCheckAttempt(atMs: Long) {
        store.edit {
            it[CHECKED_AT] = atMs
            it[CHECK_FAILED] = true
        }
    }

    /** A failure keeps the release known before; a success replaces it (or forgets it: no release). */
    suspend fun recordCheckOutcome(result: LatestRelease) {
        store.edit { prefs ->
            when (result) {
                is LatestRelease.Found -> {
                    prefs[CHECK_FAILED] = false
                    writeRelease(prefs, result.release)
                }
                LatestRelease.NoRelease -> {
                    prefs[CHECK_FAILED] = false
                    clearRelease(prefs)
                }
                is LatestRelease.Failed -> prefs[CHECK_FAILED] = true
            }
        }
    }

    suspend fun setLaterUntil(atMs: Long) {
        store.edit { it[LATER_UNTIL] = atMs }
    }

    /** The versionCode and versionName whose notes were last seen; null codes before 1.2.0. */
    suspend fun lastSeen(): Pair<Int?, AppVersion?> {
        val prefs = data.first()
        return prefs[SEEN_CODE] to prefs[SEEN_VERSION]?.let(AppVersion::parse)
    }

    suspend fun setLastSeen(code: Int, version: AppVersion) {
        store.edit {
            it[SEEN_CODE] = code
            it[SEEN_VERSION] = version.toString()
        }
    }

    private companion object {
        val LATEST_VERSION = stringPreferencesKey("app_update_latest_version")
        val LATEST_NOTES = stringPreferencesKey("app_update_latest_notes")
        val LATEST_APK_URL = stringPreferencesKey("app_update_latest_apk_url")
        val LATEST_APK_SIZE = longPreferencesKey("app_update_latest_apk_size")
        val LATEST_PAGE_URL = stringPreferencesKey("app_update_latest_page_url")
        val CHECKED_AT = longPreferencesKey("app_update_checked_at")
        val CHECK_FAILED = booleanPreferencesKey("app_update_check_failed")
        val LATER_UNTIL = longPreferencesKey("app_update_later_until")
        val SEEN_CODE = intPreferencesKey("whats_new_seen_code")
        val SEEN_VERSION = stringPreferencesKey("whats_new_seen_version")

        /** The stored release passes the same checks as one from GitHub, or it is ignored. */
        fun readRelease(prefs: Preferences): AppRelease? {
            val version = prefs[LATEST_VERSION]?.let(AppVersion::parse) ?: return null
            val apkUrl = prefs[LATEST_APK_URL]?.takeIf(ApkUrls::allowedStart) ?: return null
            val size = prefs[LATEST_APK_SIZE]?.takeIf { it in 1..ApkUrls.MAX_APK_BYTES } ?: return null
            return AppRelease(
                version = version,
                notes = prefs[LATEST_NOTES]?.let(ReleaseNotes::parse) ?: ReleaseNotes.EMPTY,
                apkUrl = apkUrl,
                apkSize = size,
                pageUrl = prefs[LATEST_PAGE_URL]?.takeIf { it.startsWith("${GitHubReleases.RELEASES_PAGE}/") }
                    ?: GitHubReleases.RELEASES_PAGE,
            )
        }

        fun writeRelease(prefs: MutablePreferences, release: AppRelease) {
            prefs[LATEST_VERSION] = release.version.toString()
            // The bullets only, as a notes file: parsed again in the app language when shown
            prefs[LATEST_NOTES] = release.notes.format()
            prefs[LATEST_APK_URL] = release.apkUrl
            prefs[LATEST_APK_SIZE] = release.apkSize
            prefs[LATEST_PAGE_URL] = release.pageUrl
        }

        fun clearRelease(prefs: MutablePreferences) {
            prefs.remove(LATEST_VERSION)
            prefs.remove(LATEST_NOTES)
            prefs.remove(LATEST_APK_URL)
            prefs.remove(LATEST_APK_SIZE)
            prefs.remove(LATEST_PAGE_URL)
        }
    }
}
