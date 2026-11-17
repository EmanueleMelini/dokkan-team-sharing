package it.emanuelemelini.dokkants.categoryhelper.overlay

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import android.widget.TextView
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import kotlin.math.roundToInt

/**
 * A short message over the game, in place of a Toast. On Android 13+ the system drops the toasts
 * of an app without the notification permission unless the app is in the foreground, and an
 * accessibility service never counts as such (the system binds it as a foreground service, one
 * step below): its toasts would not show. This is a window of the same kind as the bubble
 * (TYPE_ACCESSIBILITY_OVERLAY, no permission needed), never focusable or touchable: taps go through
 * to the game and the keyboard stays. One message at a time; a new one replaces the current one.
 */
class MessageOverlay(
    private val service: AccessibilityService,
    private val handler: Handler,
) {
    private val windowManager = service.getSystemService(WindowManager::class.java)
    private var view: View? = null
    private val timeout = Runnable { hide() }

    private val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply {
        // Where a toast goes, above the navigation bar, with the toast's fade in and out
        gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        y = dp(BOTTOM_MARGIN_DP)
        windowAnimations = android.R.style.Animation_Toast
    }

    /** Shows [text] for [durationMs] (longer if the user asked Android for more time to read). */
    fun show(text: CharSequence, durationMs: Long) {
        hide()
        val message = createView(text)
        runCatching { windowManager.addView(message, params) }
            .onSuccess {
                view = message
                handler.postDelayed(timeout, readingTime(durationMs))
                DebugLog.d { "message shown: \"$text\"" }
            }
            .onFailure { DebugLog.w("message: addView failed", it) }
    }

    fun hide() {
        handler.removeCallbacks(timeout)
        val message = view ?: return
        view = null
        runCatching { windowManager.removeView(message) }
    }

    private fun createView(text: CharSequence): View = TextView(service).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        maxWidth = service.resources.displayMetrics.widthPixels - 2 * dp(SIDE_MARGIN_DP)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        background = GradientDrawable().apply {
            cornerRadius = dp(20).toFloat()
            setColor(service.getColor(R.color.ic_launcher_background))
        }
        // Read out by TalkBack like a toast
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }

    private fun readingTime(durationMs: Long): Long {
        if (Build.VERSION.SDK_INT < 29) return durationMs
        val accessibility = service.getSystemService(AccessibilityManager::class.java)
        return accessibility
            .getRecommendedTimeoutMillis(durationMs.toInt(), AccessibilityManager.FLAG_CONTENT_TEXT)
            .toLong()
    }

    private fun dp(value: Int): Int = (value * service.resources.displayMetrics.density).roundToInt()

    companion object {
        /** As long as a short toast. */
        const val SHORT_MS = 2_000L

        /** As long as a long toast. */
        const val LONG_MS = 3_500L

        private const val BOTTOM_MARGIN_DP = 64
        private const val SIDE_MARGIN_DP = 24
    }
}
