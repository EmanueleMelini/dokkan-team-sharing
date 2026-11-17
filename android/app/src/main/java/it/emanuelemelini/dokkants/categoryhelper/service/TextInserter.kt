package it.emanuelemelini.dokkants.categoryhelper.service

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.os.Handler
import android.view.accessibility.AccessibilityNodeInfo
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.NodeDumper

/**
 * The "pending insertion" flow of the spec (validated in Phase 0).
 *
 * After a selection the Japanese name is already in the clipboard; here it becomes the pending
 * text. The first editable field of the monitored app that has input focus gets it, trying in
 * order ACTION_SET_TEXT, then ACTION_PASTE; if both are refused a message says to paste by hand.
 * Only one attempt per pending text, and it expires after [PENDING_TIMEOUT_MS].
 *
 * Variant: if the game's field is still focused when the panel closes (or the field focused before
 * opening it is still alive), the text goes in right away.
 */
class TextInserter(
    private val service: AccessibilityService,
    private val handler: Handler,
    private val onPendingChanged: (Boolean) -> Unit,
    /** Shows a short message over the game (the service's MessageOverlay, not a toast). */
    private val showMessage: (CharSequence) -> Unit,
) {
    /** Package whose fields may receive the text (the monitored app). */
    var targetPackage: String = ""

    private var pendingText: String? = null

    /** Last editable field of the monitored app that got focus: the "field focused before the panel". */
    private var lastFocusedField: AccessibilityNodeInfo? = null

    private val expire = Runnable {
        if (pendingText != null) {
            DebugLog.d { "insert: pending text expired" }
            clearPending()
        }
    }

    private val checkFocusedNow = Runnable {
        if (pendingText == null) return@Runnable
        val node = focusedField() ?: lastFocusedField?.takeIf { it.refresh() && it.isFocused && it.isEditable }
        if (node != null) {
            insert(node, "field already focused")
        } else {
            DebugLog.d { "insert: no focused field yet, waiting for one" }
        }
    }

    val hasPending: Boolean get() = pendingText != null

    /** After a selection (the panel is already closed): insert now if possible, else wait for the field. */
    fun insertOrWait(text: String) {
        pendingText = text
        handler.removeCallbacks(expire)
        handler.postDelayed(expire, PENDING_TIMEOUT_MS)
        onPendingChanged(true)
        DebugLog.d { "insert: pending \"$text\"" }
        // Give the game's window a moment to get focus back from the panel
        handler.removeCallbacks(checkFocusedNow)
        handler.postDelayed(checkFocusedNow, AFTER_PANEL_DELAY_MS)
    }

    /** TYPE_VIEW_FOCUSED from the monitored app on an editable node. */
    fun onFieldFocused(node: AccessibilityNodeInfo) {
        lastFocusedField = node
        if (pendingText != null) insert(node, "focus event")
    }

    /** Window changes (the keyboard appearing): the field may have input focus without a focus event. */
    fun onWindowsChanged() {
        if (pendingText == null) return
        focusedField()?.let { insert(it, "windows changed") }
    }

    /** Leaving the game, screen off, mode changed: nothing must be written later. */
    fun cancel() {
        if (pendingText != null) DebugLog.d { "insert: pending text cancelled" }
        clearPending()
        lastFocusedField = null
    }

    private fun focusedField(): AccessibilityNodeInfo? =
        service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?.takeIf { it.isEditable && it.packageName == targetPackage }

    private fun insert(node: AccessibilityNodeInfo, reason: String) {
        val text = pendingText ?: return
        if (!node.isEditable || node.packageName != targetPackage) return
        // One attempt only: our own text/focus changes must not trigger another
        clearPending()
        DebugLog.d { "insert ($reason) into ${NodeDumper.describe(node)}" }

        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            DebugLog.d { "insert: SET_TEXT accepted" }
            logResult(node, text)
            return
        }
        // The clipboard already holds the text
        if (node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) {
            DebugLog.d { "insert: SET_TEXT refused, PASTE accepted" }
            logResult(node, text)
            return
        }
        DebugLog.d { "insert: SET_TEXT and PASTE refused" }
        showMessage(service.getString(R.string.insert_failed))
    }

    private fun logResult(node: AccessibilityNodeInfo, expected: String) {
        if (!DebugLog.enabled) return
        handler.postDelayed({
            val alive = node.refresh()
            DebugLog.d { "insert: field now \"${node.text}\" (refresh=$alive, ok=${node.text?.contains(expected) == true})" }
        }, VERIFY_DELAY_MS)
    }

    private fun clearPending() {
        val hadPending = pendingText != null
        pendingText = null
        handler.removeCallbacks(expire)
        handler.removeCallbacks(checkFocusedNow)
        if (hadPending) onPendingChanged(false)
    }

    private companion object {
        const val PENDING_TIMEOUT_MS = 30_000L
        const val AFTER_PANEL_DELAY_MS = 250L
        const val VERIFY_DELAY_MS = 300L
    }
}
