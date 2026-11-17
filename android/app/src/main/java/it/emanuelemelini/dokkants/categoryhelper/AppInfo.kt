package it.emanuelemelini.dokkants.categoryhelper

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/** Facts about this app shown in the settings and sent as the User-Agent of the update check. */
object AppInfo {

    /** The site page with the instructions (setup, the dictionary, the update check). */
    const val INSTRUCTIONS_URL = "https://dokkants.app/category-helper"

    fun versionName(context: Context): String = runCatching {
        if (Build.VERSION.SDK_INT >= 33) {
            context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0)).versionName
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }
    }.getOrNull() ?: "?"
}
