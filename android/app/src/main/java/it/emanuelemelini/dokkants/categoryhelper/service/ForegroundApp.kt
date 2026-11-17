package it.emanuelemelini.dokkants.categoryhelper.service

import android.view.accessibility.AccessibilityWindowInfo

/**
 * Which app is in front, from the accessibility window list (rule validated in Phase 0).
 *
 * Only application windows count, so the keyboard, System UI, the Game Assistant sidebar and
 * overlays never do. Windows that sit above Dokkan without being active (Play Store / Play
 * services at game start) don't count either.
 */
object ForegroundApp {

    /**
     * Package of the active (else focused) application window, or null when it can't be told:
     * no application window is active (app switch in progress, notification shade, recents on
     * some launchers) or the active one is this app. Callers keep their current state on null.
     */
    fun find(windows: List<AccessibilityWindowInfo>, ownPackage: String): String? {
        val window = windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive }
            ?: windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isFocused }
            ?: return null
        val pkg = window.root?.packageName?.toString() ?: return null
        return pkg.takeIf { it != ownPackage }
    }
}
