package it.emanuelemelini.dokkants.categoryhelper.overlay

import android.accessibilityservice.AccessibilityService
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import it.emanuelemelini.dokkants.categoryhelper.settings.AppSettings
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * The compact bubble: a small translucent circle drawn with TYPE_ACCESSIBILITY_OVERLAY (no
 * SYSTEM_ALERT_WINDOW needed). It is never focusable, so it can't steal input or the keyboard
 * from the game. It can be dragged anywhere, snaps to the nearest side edge when released and
 * reports where it rests so the position can be saved.
 */
class BubbleOverlay(
    private val service: AccessibilityService,
    private val onTap: () -> Unit,
    private val onMoved: (onRight: Boolean, yFraction: Float) -> Unit,
) {
    private val windowManager = service.getSystemService(WindowManager::class.java)
    private val touchSlop = ViewConfiguration.get(service).scaledTouchSlop.toFloat()
    private val edgeMargin = dp(4)
    private val verticalMargin = dp(24)

    private var opacity = AppSettings.DEFAULT_OPACITY
    private var sizePx = dp(AppSettings.DEFAULT_SIZE_DP)
    private var onRight = true
    private var yFraction = AppSettings.DEFAULT_Y_FRACTION

    private var view: View? = null
    private var snapAnimator: ValueAnimator? = null
    private var dragging = false

    /** A selected name waits for the game's field: the bubble is fully opaque with a ring. */
    private var pending = false

    private val params = WindowManager.LayoutParams(
        sizePx,
        sizePx,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        // Coordinates relative to the whole display, like the game (drawn edge to edge)
        if (Build.VERSION.SDK_INT >= 28) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= 30) fitInsetsTypes = 0
    }

    val isShowing: Boolean get() = view != null

    /** New opacity, size or saved position: applied at once if the bubble is on screen. */
    fun update(settings: AppSettings) {
        opacity = settings.bubbleOpacity
        sizePx = dp(settings.bubbleSizeDp)
        onRight = settings.bubbleOnRight
        yFraction = settings.bubbleYFraction
        val bubble = view ?: return
        if (dragging) return
        bubble.alpha = restingAlpha()
        params.width = sizePx
        params.height = sizePx
        placeAtSavedPosition()
        relayout()
    }

    fun show() {
        if (view != null) return
        val bubble = createView()
        params.width = sizePx
        params.height = sizePx
        placeAtSavedPosition()
        runCatching { windowManager.addView(bubble, params) }
            .onSuccess {
                view = bubble
                bubble.alpha = 0f
                bubble.animate().alpha(restingAlpha()).setDuration(FADE_MS).start()
                DebugLog.d { "bubble shown at ${params.x},${params.y}" }
            }
            .onFailure { DebugLog.w("bubble: addView failed", it) }
    }

    fun hide() {
        val bubble = view ?: return
        view = null
        dragging = false
        snapAnimator?.cancel()
        runCatching { windowManager.removeView(bubble) }
        DebugLog.d { "bubble hidden" }
    }

    fun setPending(value: Boolean) {
        if (pending == value) return
        pending = value
        val bubble = view ?: return
        bubble.background = background()
        if (!dragging) bubble.animate().alpha(restingAlpha()).setDuration(FADE_MS).start()
    }

    private fun restingAlpha() = if (pending) 1f else opacity

    private fun background() = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(service.getColor(R.color.ic_launcher_background))
        if (pending) setStroke(dp(3), Color.WHITE)
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createView(): View = ImageView(service).apply {
        // The launcher foreground cropped to the 72dp a launcher shows: the whole 108dp canvas
        // would leave the mark at half the bubble
        setImageResource(R.drawable.ic_bubble_foreground)
        scaleType = ImageView.ScaleType.FIT_CENTER
        background = background()
        contentDescription = service.getString(R.string.bubble_description)
        setOnClickListener { onTap() }
        setOnTouchListener(DragListener())
    }

    private fun placeAtSavedPosition() {
        val screen = screenSize()
        params.x = if (onRight) screen.x - sizePx - edgeMargin else edgeMargin
        params.y = (minY() + yFraction * (maxY(screen) - minY())).roundToInt()
    }

    /** Lets go of the bubble at the nearest side edge, then reports the resting place. */
    private fun snapToEdge() {
        val screen = screenSize()
        onRight = params.x + sizePx / 2 > screen.x / 2
        yFraction = ((params.y - minY()).toFloat() / (maxY(screen) - minY()).coerceAtLeast(1)).coerceIn(0f, 1f)
        val targetX = if (onRight) screen.x - sizePx - edgeMargin else edgeMargin
        snapAnimator?.cancel()
        snapAnimator = ValueAnimator.ofInt(params.x, targetX).apply {
            duration = SNAP_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                params.x = it.animatedValue as Int
                relayout()
            }
            start()
        }
        onMoved(onRight, yFraction)
    }

    private fun relayout() {
        val bubble = view ?: return
        runCatching { windowManager.updateViewLayout(bubble, params) }
    }

    private fun minY() = verticalMargin

    private fun maxY(screen: Point) = (screen.y - sizePx - verticalMargin).coerceAtLeast(minY())

    private fun screenSize(): Point = if (Build.VERSION.SDK_INT >= 30) {
        val bounds = windowManager.maximumWindowMetrics.bounds
        Point(bounds.width(), bounds.height())
    } else {
        Point().also {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealSize(it)
        }
    }

    private fun dp(value: Int): Int = (value * service.resources.displayMetrics.density).roundToInt()

    /** A tap opens (Phase 2: the search panel); past the touch slop it becomes a drag. */
    private inner class DragListener : View.OnTouchListener {
        private var downX = 0f
        private var downY = 0f
        private var startX = 0
        private var startY = 0

        override fun onTouch(v: View, event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    snapAnimator?.cancel()
                    downX = event.rawX
                    downY = event.rawY
                    startX = params.x
                    startY = params.y
                    dragging = false
                    v.animate().cancel()
                    v.alpha = 1f
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && hypot(dx, dy) > touchSlop) dragging = true
                    if (dragging) {
                        val screen = screenSize()
                        params.x = (startX + dx).roundToInt().coerceIn(0, screen.x - sizePx)
                        params.y = (startY + dy).roundToInt().coerceIn(minY(), maxY(screen))
                        relayout()
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging) {
                        dragging = false
                        snapToEdge()
                    } else if (event.actionMasked == MotionEvent.ACTION_UP) {
                        v.performClick()
                    }
                    v.animate().alpha(restingAlpha()).setDuration(FADE_MS).start()
                }
            }
            return true
        }
    }

    private companion object {
        const val FADE_MS = 150L
        const val SNAP_MS = 180L
    }
}
