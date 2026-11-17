package it.emanuelemelini.dokkants.categoryhelper

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build

/** Package names of Dokkan Battle. JP verified in Phase 0; Global still from the spec. */
object DokkanPackages {
    const val JP = "com.bandainamcogames.dbzdokkan"
    const val GLOBAL = "com.bandainamcogames.dbzdokkanww"

    data class InstalledApp(val packageName: String, val label: String, val versionName: String)

    /** The author's apps: never Dokkan itself (an older build of this app, under its old id, included). */
    private const val AUTHOR_PREFIX = "it.emanuelemelini."

    /** Whether [pkg] can be offered as the monitored app: "dokkan" in the name, not this app or another of the author's. */
    internal fun isCandidate(pkg: String, self: String): Boolean =
        pkg != self && !pkg.startsWith(AUTHOR_PREFIX) && pkg.contains("dokkan", ignoreCase = true)

    /** Launchable apps that pass [isCandidate], to pick the monitored one. */
    fun findInstalled(context: Context): List<InstalledApp> {
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities: List<ResolveInfo> = if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentActivities(launcher, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(launcher, 0)
        }
        return activities
            .filter { isCandidate(it.activityInfo.packageName, context.packageName) }
            .distinctBy { it.activityInfo.packageName }
            .map {
                val pkg = it.activityInfo.packageName
                val version = runCatching {
                    if (Build.VERSION.SDK_INT >= 33) {
                        pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0)).versionName
                    } else {
                        @Suppress("DEPRECATION")
                        pm.getPackageInfo(pkg, 0).versionName
                    }
                }.getOrNull() ?: "?"
                InstalledApp(pkg, it.loadLabel(pm).toString(), version)
            }
            .sortedBy { it.packageName }
    }
}
