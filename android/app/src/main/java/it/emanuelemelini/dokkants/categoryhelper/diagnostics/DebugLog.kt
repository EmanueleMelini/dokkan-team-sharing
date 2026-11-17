package it.emanuelemelini.dokkants.categoryhelper.diagnostics

import android.util.Log

/**
 * Diagnostic log, off by default and switched on from the settings screen:
 * `adb logcat -s DokkanHelper`. Warnings are always written.
 */
object DebugLog {
    const val TAG = "DokkanHelper"

    @Volatile
    var enabled = false

    inline fun d(message: () -> String) {
        if (enabled) Log.i(TAG, message())
    }

    fun block(header: String, lines: List<String>) {
        if (!enabled) return
        Log.i(TAG, header)
        lines.forEach { Log.i(TAG, "  $it") }
    }

    fun w(message: String, error: Throwable? = null) {
        Log.w(TAG, message, error)
    }
}
