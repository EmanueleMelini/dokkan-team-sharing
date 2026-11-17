package it.emanuelemelini.dokkants.categoryhelper.diagnostics

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/** Readable one-line descriptions of accessibility nodes and windows, for the diagnostic log. */
object NodeDumper {

    /** Class, view id, texts, state flags, bounds, input type and supported actions of one node. */
    fun describe(node: AccessibilityNodeInfo): String = buildString {
        append(node.className ?: "?")
        node.viewIdResourceName?.let { append(" id=").append(it) }
        node.text?.let { append(" text=\"").append(it.take(80)).append('"') }
        node.hintText?.let { append(" hint=\"").append(it.take(80)).append('"') }

        val flags = buildList {
            if (node.isEditable) add("EDITABLE")
            if (node.isFocused) add("FOCUSED")
            if (node.isFocusable) add("focusable")
            if (!node.isVisibleToUser) add("invisible")
        }
        if (flags.isNotEmpty()) append(" [").append(flags.joinToString(",")).append(']')

        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        append(" bounds=").append(bounds.toShortString())
        if (node.inputType != 0) append(" inputType=0x").append(Integer.toHexString(node.inputType))
        append(" pkg=").append(node.packageName)
        append(" actions=").append(node.actionList.joinToString(",") { actionName(it) })
    }

    fun describe(window: AccessibilityWindowInfo, rootPackage: CharSequence?): String = buildString {
        append('#').append(window.id)
        append(' ').append(windowTypeName(window.type))
        append(" layer=").append(window.layer)
        if (window.isActive) append(" ACTIVE")
        if (window.isFocused) append(" FOCUSED")
        append(" pkg=").append(rootPackage)
        window.title?.let { append(" title=\"").append(it).append('"') }
    }

    private fun windowTypeName(type: Int): String = when (type) {
        AccessibilityWindowInfo.TYPE_APPLICATION -> "APP"
        AccessibilityWindowInfo.TYPE_INPUT_METHOD -> "IME"
        AccessibilityWindowInfo.TYPE_SYSTEM -> "SYSTEM"
        AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY -> "A11Y_OVERLAY"
        AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER -> "DIVIDER"
        else -> "TYPE_$type"
    }

    /** "SET_TEXT", "PASTE", … taken from the platform's own symbolic name, plus the label if any. */
    private fun actionName(action: AccessibilityNodeInfo.AccessibilityAction): String {
        val symbolic = action.toString()
            .removePrefix("AccessibilityAction: ")
            .substringBefore(" - ")
            .removePrefix("ACTION_")
        return action.label?.let { "$symbolic($it)" } ?: symbolic
    }
}
