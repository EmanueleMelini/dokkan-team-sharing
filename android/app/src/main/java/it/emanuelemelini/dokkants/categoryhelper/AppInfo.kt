package it.emanuelemelini.dokkants.categoryhelper

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build

/** Facts about this app shown in the settings and sent as the User-Agent of the update checks. */
object AppInfo {

    /** The site page with the instructions (setup, the dictionary, the update checks). */
    const val INSTRUCTIONS_URL = "https://dokkants.app/category-helper"

    fun versionName(context: Context): String = packageInfo(context, context.packageName)?.versionName ?: "?"

    /** The installed package, or null when it is not installed (or not visible to this app). */
    fun packageInfo(context: Context, packageName: String): PackageInfo? = try {
        if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(packageName, 0)
        }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }
}
