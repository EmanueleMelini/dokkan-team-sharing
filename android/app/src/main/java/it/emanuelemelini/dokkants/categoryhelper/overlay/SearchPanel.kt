package it.emanuelemelini.dokkants.categoryhelper.overlay

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryRepository
import it.emanuelemelini.dokkants.categoryhelper.history.HistoryRepository
import it.emanuelemelini.dokkants.categoryhelper.ui.AppTheme

/**
 * The expanded state: a full-screen TYPE_ACCESSIBILITY_OVERLAY window with the search card. Unlike
 * the bubble it is focusable, so the search field can get the keyboard. It closes on a tap outside
 * the card, on back, or after a selection (the caller decides, through [onClose] / [onSelect]).
 */
class SearchPanel(
    private val service: AccessibilityService,
    private val dictionary: DictionaryRepository,
    private val history: HistoryRepository,
    private val onSelect: (Category) -> Unit,
    private val onToggleFavorite: (Category) -> Unit,
    private val onClose: () -> Unit,
) {
    private val windowManager = service.getSystemService(WindowManager::class.java)
    private var root: ViewGroup? = null
    private var owner: OverlayLifecycleOwner? = null

    val isShowing: Boolean get() = root != null

    private val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        // Focusable and touch-modal: while open, the whole screen belongs to the panel
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        @Suppress("DEPRECATION")
        softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
            WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE
        if (Build.VERSION.SDK_INT >= 28) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        // Edge to edge: the content pads itself for status bar and keyboard (WindowInsets)
        if (Build.VERSION.SDK_INT >= 30) fitInsetsTypes = 0
    }

    fun show() {
        if (root != null) return
        val lifecycleOwner = OverlayLifecycleOwner().apply { resume() }
        val compose = ComposeView(service).apply {
            setContent {
                AppTheme {
                    val loaded by dictionary.dictionary.collectAsState()
                    val favorites by history.favorites.collectAsState(initial = emptySet())
                    val recents by history.recents.collectAsState(initial = emptyList())
                    SearchPanelContent(
                        categories = loaded?.categories,
                        favoriteIds = favorites,
                        recentIds = recents,
                        onSelect = onSelect,
                        onToggleFavorite = onToggleFavorite,
                        onClose = onClose,
                    )
                }
            }
        }
        val panelRoot = PanelRootView(service, onBack = onClose).apply {
            addView(compose, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            setViewTreeLifecycleOwner(lifecycleOwner)
            setViewTreeSavedStateRegistryOwner(lifecycleOwner)
        }
        runCatching { windowManager.addView(panelRoot, params) }
            .onSuccess {
                root = panelRoot
                owner = lifecycleOwner
                DebugLog.d { "panel shown" }
            }
            .onFailure {
                lifecycleOwner.destroy()
                DebugLog.w("panel: addView failed", it)
            }
    }

    fun hide() {
        val panelRoot = root ?: return
        root = null
        runCatching { windowManager.removeView(panelRoot) }
        owner?.destroy()
        owner = null
        DebugLog.d { "panel hidden" }
    }

    /** Root of the panel window: turns the back gesture/key into [onBack]. */
    @SuppressLint("ViewConstructor")
    private class PanelRootView(context: Context, private val onBack: () -> Unit) : FrameLayout(context) {
        private var backCallback: Any? = null

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                if (event.action == KeyEvent.ACTION_UP) onBack()
                return true
            }
            return super.dispatchKeyEvent(event)
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            if (Build.VERSION.SDK_INT >= 33) registerBack()
        }

        override fun onDetachedFromWindow() {
            if (Build.VERSION.SDK_INT >= 33) unregisterBack()
            super.onDetachedFromWindow()
        }

        // Predictive back (default when targeting Android 16+): the key event is no longer sent
        @RequiresApi(33)
        private fun registerBack() {
            val callback = OnBackInvokedCallback { onBack() }
            findOnBackInvokedDispatcher()?.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                callback,
            )
            backCallback = callback
        }

        @RequiresApi(33)
        private fun unregisterBack() {
            (backCallback as? OnBackInvokedCallback)?.let {
                findOnBackInvokedDispatcher()?.unregisterOnBackInvokedCallback(it)
            }
            backCallback = null
        }
    }
}
