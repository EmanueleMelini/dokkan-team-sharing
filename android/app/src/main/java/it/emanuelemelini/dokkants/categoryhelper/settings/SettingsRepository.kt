package it.emanuelemelini.dokkants.categoryhelper.settings

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import it.emanuelemelini.dokkants.categoryhelper.DokkanPackages
import it.emanuelemelini.dokkants.categoryhelper.update.AutoUpdatePolicy
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

data class AppSettings(
    /** Show the bubble automatically while the monitored app is in front. */
    val autoShow: Boolean = true,
    /** Package that makes the bubble appear (Dokkan JP by default). */
    val targetPackage: String = DokkanPackages.JP,
    val bubbleOpacity: Float = DEFAULT_OPACITY,
    val bubbleSizeDp: Int = DEFAULT_SIZE_DP,
    /** The bubble rests against the right edge (else the left one)… */
    val bubbleOnRight: Boolean = true,
    /** …at this height, as a fraction of the space it can move in (survives size changes). */
    val bubbleYFraction: Float = DEFAULT_Y_FRACTION,
    /** What a selection in the panel does besides copying to the clipboard. */
    val insertMode: InsertMode = InsertMode.AUTO,
    /** Foreground decisions and focused nodes in Logcat (tag DokkanHelper). */
    val debugLog: Boolean = false,
    /** "Check automatically": new categories and, in release builds, a new version of the app, at most once a day. */
    val autoUpdate: Boolean = true,
) {
    companion object {
        const val DEFAULT_OPACITY = 0.35f
        const val MIN_OPACITY = 0.1f
        const val DEFAULT_SIZE_DP = 48
        const val MIN_SIZE_DP = 36
        const val MAX_SIZE_DP = 72
        const val DEFAULT_Y_FRACTION = 0.3f
    }
}

/**
 * The last automatic update check: when it started (epoch ms) and how it ended. Kept apart from
 * [AppSettings], so recording a check does not re-apply the settings to the bubble.
 */
data class AutoCheckRecord(val atMs: Long, val outcome: AutoUpdatePolicy.Outcome)

enum class InsertMode {
    /** Also write the Japanese name into the game's search field (pending insertion, Phase 3). */
    AUTO,

    /** Clipboard only: the user pastes it. */
    CLIPBOARD,
}

class SettingsRepository(context: Context) {
    private val store = context.applicationContext.appDataStore

    val settings: Flow<AppSettings> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map { prefs ->
            AppSettings(
                autoShow = prefs[AUTO_SHOW] ?: true,
                targetPackage = prefs[TARGET_PACKAGE]?.trim()?.takeIf { it.isNotEmpty() } ?: DokkanPackages.JP,
                bubbleOpacity = (prefs[BUBBLE_OPACITY] ?: AppSettings.DEFAULT_OPACITY)
                    .coerceIn(AppSettings.MIN_OPACITY, 1f),
                bubbleSizeDp = (prefs[BUBBLE_SIZE_DP] ?: AppSettings.DEFAULT_SIZE_DP)
                    .coerceIn(AppSettings.MIN_SIZE_DP, AppSettings.MAX_SIZE_DP),
                bubbleOnRight = prefs[BUBBLE_ON_RIGHT] ?: true,
                bubbleYFraction = (prefs[BUBBLE_Y_FRACTION] ?: AppSettings.DEFAULT_Y_FRACTION).coerceIn(0f, 1f),
                insertMode = prefs[INSERT_MODE]
                    ?.let { stored -> InsertMode.entries.firstOrNull { it.name == stored } }
                    ?: InsertMode.AUTO,
                debugLog = prefs[DEBUG_LOG] ?: false,
                autoUpdate = prefs[AUTO_UPDATE] ?: true,
            )
        }
        .distinctUntilChanged()

    /** Null until the first automatic check. */
    val lastAutoCheck: Flow<AutoCheckRecord?> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map { prefs ->
            prefs[LAST_AUTO_CHECK_AT]?.let { at ->
                AutoCheckRecord(
                    atMs = at,
                    outcome = AutoUpdatePolicy.Outcome(
                        failed = prefs[LAST_AUTO_CHECK_FAILED] ?: true,
                        added = prefs[LAST_AUTO_CHECK_ADDED] ?: 0,
                    ),
                )
            }
        }
        .distinctUntilChanged()

    /** The package field as typed (may be blank: then the JP default applies). */
    val rawTargetPackage: Flow<String> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }
        .map { it[TARGET_PACKAGE] ?: DokkanPackages.JP }
        .distinctUntilChanged()

    suspend fun setAutoShow(value: Boolean) {
        store.edit { it[AUTO_SHOW] = value }
    }

    suspend fun setTargetPackage(value: String) {
        store.edit { it[TARGET_PACKAGE] = value }
    }

    suspend fun setBubbleOpacity(value: Float) {
        store.edit { it[BUBBLE_OPACITY] = value.coerceIn(AppSettings.MIN_OPACITY, 1f) }
    }

    suspend fun setBubbleSize(dp: Int) {
        store.edit { it[BUBBLE_SIZE_DP] = dp.coerceIn(AppSettings.MIN_SIZE_DP, AppSettings.MAX_SIZE_DP) }
    }

    suspend fun setBubblePosition(onRight: Boolean, yFraction: Float) {
        store.edit {
            it[BUBBLE_ON_RIGHT] = onRight
            it[BUBBLE_Y_FRACTION] = yFraction.coerceIn(0f, 1f)
        }
    }

    suspend fun resetBubblePosition() {
        store.edit {
            it.remove(BUBBLE_ON_RIGHT)
            it.remove(BUBBLE_Y_FRACTION)
        }
    }

    suspend fun setInsertMode(value: InsertMode) {
        store.edit { it[INSERT_MODE] = value.name }
    }

    suspend fun setDebugLog(value: Boolean) {
        store.edit { it[DEBUG_LOG] = value }
    }

    suspend fun setAutoUpdate(value: Boolean) {
        store.edit { it[AUTO_UPDATE] = value }
    }

    /** Written before going online: until [recordAutoCheckOutcome] the attempt counts as failed. */
    suspend fun recordAutoCheckAttempt(atMs: Long) {
        store.edit {
            it[LAST_AUTO_CHECK_AT] = atMs
            it[LAST_AUTO_CHECK_FAILED] = AutoUpdatePolicy.UNFINISHED.failed
            it[LAST_AUTO_CHECK_ADDED] = AutoUpdatePolicy.UNFINISHED.added
        }
    }

    suspend fun recordAutoCheckOutcome(outcome: AutoUpdatePolicy.Outcome) {
        store.edit {
            it[LAST_AUTO_CHECK_FAILED] = outcome.failed
            it[LAST_AUTO_CHECK_ADDED] = outcome.added
        }
    }

    private companion object {
        val AUTO_SHOW = booleanPreferencesKey("auto_show")
        val TARGET_PACKAGE = stringPreferencesKey("target_package")
        val BUBBLE_OPACITY = floatPreferencesKey("bubble_opacity")
        val BUBBLE_SIZE_DP = intPreferencesKey("bubble_size_dp")
        val BUBBLE_ON_RIGHT = booleanPreferencesKey("bubble_on_right")
        val BUBBLE_Y_FRACTION = floatPreferencesKey("bubble_y_fraction")
        val INSERT_MODE = stringPreferencesKey("insert_mode")
        val DEBUG_LOG = booleanPreferencesKey("debug_log")
        val AUTO_UPDATE = booleanPreferencesKey("auto_update")
        val LAST_AUTO_CHECK_AT = longPreferencesKey("last_auto_check_at")
        val LAST_AUTO_CHECK_FAILED = booleanPreferencesKey("last_auto_check_failed")
        val LAST_AUTO_CHECK_ADDED = intPreferencesKey("last_auto_check_added")
    }
}
