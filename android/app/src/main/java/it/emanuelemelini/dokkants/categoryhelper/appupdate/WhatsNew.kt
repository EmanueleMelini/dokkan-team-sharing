package it.emanuelemelini.dokkants.categoryhelper.appupdate

import android.content.Context
import it.emanuelemelini.dokkants.categoryhelper.AppInfo
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The notes of one version, as bundled in the app. */
data class ChangelogEntry(val version: AppVersion, val notes: ReleaseNotes)

/**
 * "What's new": the notes of every version, read from `assets/release-notes/X.Y.Z.md`, the same
 * files the release workflow publishes on GitHub, so the app shows them offline.
 */
object Changelog {

    const val DIRECTORY = "release-notes"

    /** Newest first; a file whose name is not a version, or that cannot be read, is skipped. */
    suspend fun entries(context: Context): List<ChangelogEntry> = withContext(Dispatchers.IO) {
        val names = try {
            context.assets.list(DIRECTORY).orEmpty()
        } catch (e: IOException) {
            DebugLog.w("release notes: cannot list the assets", e)
            emptyArray()
        }
        names.mapNotNull { name ->
            if (!name.endsWith(".md")) return@mapNotNull null
            val version = AppVersion.parse(name.removeSuffix(".md")) ?: return@mapNotNull null
            try {
                val text = context.assets.open("$DIRECTORY/$name").bufferedReader().use { it.readText() }
                ChangelogEntry(version, ReleaseNotes.parse(text))
            } catch (e: IOException) {
                DebugLog.w("release notes: cannot read $name", e)
                null
            }
        }.sortedByDescending { it.version }
    }

    /** True when the app was installed and never updated (or reinstalled from scratch). */
    fun isFreshInstall(context: Context): Boolean =
        AppInfo.packageInfo(context, context.packageName)?.let { it.firstInstallTime == it.lastUpdateTime } ?: true
}

/** Which notes "What's new" shows at the first start after an update. Pure. */
object WhatsNewPolicy {

    /**
     * The versions to show, newest first, out of the [bundled] ones up to [current]:
     * - [lastSeenCode] null: nothing after a [freshInstall]; after an update from 1.1.0 or older
     *   (which kept no record), the notes of [current] only;
     * - [lastSeenCode] not lower than [currentCode]: nothing (already seen, or a downgrade);
     * - otherwise every version newer than [lastSeenVersion] (just [current] when that is unknown).
     */
    fun pending(
        lastSeenCode: Int?,
        lastSeenVersion: AppVersion?,
        currentCode: Int,
        current: AppVersion,
        freshInstall: Boolean,
        bundled: List<AppVersion>,
    ): List<AppVersion> {
        val upToCurrent = bundled.filter { it <= current }.distinct().sortedDescending()
        return when {
            lastSeenCode == null && freshInstall -> emptyList()
            lastSeenCode == null -> upToCurrent.filter { it == current }
            lastSeenCode >= currentCode -> emptyList()
            lastSeenVersion == null -> upToCurrent.filter { it == current }
            else -> upToCurrent.filter { it > lastSeenVersion }
        }
    }
}
