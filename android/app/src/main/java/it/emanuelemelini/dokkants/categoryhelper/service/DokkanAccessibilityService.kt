package it.emanuelemelini.dokkants.categoryhelper.service

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.NodeDumper
import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryRepository
import it.emanuelemelini.dokkants.categoryhelper.history.HistoryRepository
import it.emanuelemelini.dokkants.categoryhelper.overlay.BubbleOverlay
import it.emanuelemelini.dokkants.categoryhelper.overlay.MessageOverlay
import it.emanuelemelini.dokkants.categoryhelper.overlay.SearchPanel
import it.emanuelemelini.dokkants.categoryhelper.settings.AppSettings
import it.emanuelemelini.dokkants.categoryhelper.settings.InsertMode
import it.emanuelemelini.dokkants.categoryhelper.settings.SettingsRepository
import it.emanuelemelini.dokkants.categoryhelper.ui.autoUpdateMessage
import it.emanuelemelini.dokkants.categoryhelper.update.AutoUpdatePolicy
import it.emanuelemelini.dokkants.categoryhelper.update.UpdateCheck
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The app's only service: tells when the monitored app (Dokkan JP) is in front and shows the
 * overlay over it: the bubble, or the search panel once the bubble is tapped. Everything goes as
 * soon as another app takes over. A selected name goes to the clipboard and, in automatic mode,
 * into the game's search field ([TextInserter]). When the monitored app comes to the front it also
 * runs the automatic "Check for updates", if due ([AutoUpdatePolicy]).
 */
class DokkanAccessibilityService : AccessibilityService() {

    companion object {
        private val connectedState = MutableStateFlow(false)

        /** True while the system has the service bound (shown in the settings screen). */
        val connected: StateFlow<Boolean> = connectedState.asStateFlow()

        /** A different app must stay in front this long before the overlay goes: no flicker on quick switches. */
        private const val HIDE_DELAY_MS = 300L
    }

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var settingsRepository: SettingsRepository
    private lateinit var history: HistoryRepository
    private lateinit var bubble: BubbleOverlay
    private lateinit var panel: SearchPanel
    private lateinit var message: MessageOverlay
    private lateinit var inserter: TextInserter

    /** Null until the stored settings are read: nothing is shown before that. */
    private var settings: AppSettings? = null
    private var lastForeground: String? = null

    /** The monitored app was the last one known in front (unknown foregrounds don't change it). */
    private var targetInFront = false

    /** The automatic update check in progress: one at a time, whatever the events. */
    private var autoCheck: Job? = null

    private var hidePending = false
    private val delayedHide = Runnable {
        hidePending = false
        targetInFront = false
        inserter.cancel()
        hideOverlay()
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            evaluate("broadcast ${intent.action}")
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        settingsRepository = SettingsRepository(this)
        history = HistoryRepository(this)
        val dictionary = DictionaryRepository.get(this)
        bubble = BubbleOverlay(
            service = this,
            onTap = ::openPanel,
            onMoved = { onRight, yFraction ->
                scope.launch { settingsRepository.setBubblePosition(onRight, yFraction) }
            },
        )
        panel = SearchPanel(
            service = this,
            dictionary = dictionary,
            history = history,
            onSelect = ::onCategorySelected,
            onToggleFavorite = { category -> scope.launch { history.toggleFavorite(category.id) } },
            onClose = ::closePanel,
        )
        message = MessageOverlay(this, handler)
        inserter = TextInserter(
            service = this,
            handler = handler,
            onPendingChanged = { bubble.setPending(it) },
            showMessage = { showMessage(it, MessageOverlay.LONG_MS) },
        )
        // Screen off / lock screen: the overlay must not stay above the keyguard
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)

        scope.launch { dictionary.ensureLoaded() }
        scope.launch {
            settingsRepository.settings.collect { newSettings ->
                settings = newSettings
                DebugLog.enabled = newSettings.debugLog
                inserter.targetPackage = newSettings.targetPackage
                if (newSettings.insertMode != InsertMode.AUTO) inserter.cancel()
                bubble.update(newSettings)
                evaluate("settings")
            }
        }
        connectedState.value = true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        // A crash would disable the service: nothing may escape from here
        try {
            when (event.eventType) {
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
                AccessibilityEvent.TYPE_WINDOWS_CHANGED,
                -> {
                    evaluate(AccessibilityEvent.eventTypeToString(event.eventType))
                    if (targetInFront) inserter.onWindowsChanged()
                }

                AccessibilityEvent.TYPE_VIEW_FOCUSED -> if (event.packageName == settings?.targetPackage) {
                    val source = event.source
                    DebugLog.d { "focus in target app: ${source?.let { NodeDumper.describe(it) }}" }
                    if (source != null && source.isEditable) inserter.onFieldFocused(source)
                }

                else -> Unit
            }
        } catch (e: Exception) {
            DebugLog.w("event handling failed", e)
        }
    }

    /** Shows or hides the overlay for the current foreground app. */
    private fun evaluate(reason: String) {
        val current = settings ?: return
        if (!current.autoShow || !screenInUse()) {
            cancelDelayedHide()
            targetInFront = false
            inserter.cancel()
            hideOverlay()
            return
        }

        val windowList = windows
        val foreground = if (windowList.isEmpty()) {
            rootInActiveWindow?.packageName?.toString()?.takeIf { it != packageName }
        } else {
            ForegroundApp.find(windowList, packageName)
        }
        if (foreground != lastForeground) {
            DebugLog.d { "foreground $lastForeground -> $foreground ($reason)" }
            DebugLog.block("windows", windowList.map { NodeDumper.describe(it, it.root?.packageName) })
            lastForeground = foreground
        }

        when (foreground) {
            // Can't tell (switch in progress, shade, this app's own panel): keep the current state
            null -> Unit
            current.targetPackage -> {
                cancelDelayedHide()
                // Only the switch to the monitored app, not every event while it stays in front
                val cameToFront = !targetInFront
                targetInFront = true
                if (!panel.isShowing) bubble.show()
                if (cameToFront) checkForUpdatesIfDue(current)
            }
            else -> if ((bubble.isShowing || panel.isShowing) && !hidePending) {
                hidePending = true
                handler.postDelayed(delayedHide, HIDE_DELAY_MS)
            }
        }
    }

    /**
     * The automatic "Check for updates": the same request and the same only-add rule as the button,
     * at most once a day ([AutoUpdatePolicy.due]). Off the event thread; a message only when new
     * categories arrive, nothing when the dictionary is up to date or the check fails.
     */
    private fun checkForUpdatesIfDue(current: AppSettings) {
        if (!current.autoUpdate || autoCheck?.isActive == true) return
        // Dispatched, not immediate: the event handler returns first
        autoCheck = scope.launch(Dispatchers.Main) {
            try {
                val now = System.currentTimeMillis()
                val last = settingsRepository.lastAutoCheck.first()
                val enabled = settings?.autoUpdate == true
                if (!AutoUpdatePolicy.due(now, last?.atMs, last?.outcome?.failed == true, enabled)) return@launch
                // Before going online: if the check never finishes, it counts as failed
                settingsRepository.recordAutoCheckAttempt(now)
                val result = withContext(Dispatchers.IO) { UpdateCheck.run(this@DokkanAccessibilityService) }
                val outcome = AutoUpdatePolicy.outcome(result)
                settingsRepository.recordAutoCheckOutcome(outcome)
                DebugLog.d { "automatic update check: $result" }
                // Not if the switch went off while the check was running
                if (outcome.announce && settings?.autoUpdate == true) {
                    showMessage(autoUpdateMessage(resources, outcome.added), MessageOverlay.LONG_MS)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                DebugLog.w("automatic update check failed", e)
            }
        }
    }

    private fun openPanel() {
        bubble.hide()
        panel.show()
    }

    /** Back to the bubble, if the monitored app is still the one in front. */
    private fun closePanel() {
        panel.hide()
        if (targetInFront && settings?.autoShow == true && screenInUse()) bubble.show()
    }

    /**
     * The Japanese name always goes to the clipboard. In automatic mode it also becomes the pending
     * text for the game's search field; otherwise the user pastes it.
     */
    private fun onCategorySelected(category: Category) {
        val clipboard = getSystemService(ClipboardManager::class.java)
        clipboard.setPrimaryClip(ClipData.newPlainText(category.en, category.jp))
        scope.launch { history.addRecent(category.id) }
        DebugLog.d { "selected ${category.id}: \"${category.jp}\" copied" }
        closePanel()

        if (settings?.insertMode == InsertMode.AUTO) {
            inserter.insertOrWait(category.jp)
        } else if (Build.VERSION.SDK_INT < 33) {
            // Android 13+ confirms clipboard copies itself
            showMessage(getString(R.string.copied_toast, category.jp), MessageOverlay.SHORT_MS)
        }
    }

    /**
     * A message over the game ([MessageOverlay]), only while it is in front: one that arrives later
     * (an automatic check that ends after the user left) is dropped, the settings keep the outcome.
     */
    private fun showMessage(text: CharSequence, durationMs: Long) {
        if (targetInFront && screenInUse()) message.show(text, durationMs)
    }

    private fun hideOverlay() {
        panel.hide()
        bubble.hide()
        message.hide()
    }

    private fun cancelDelayedHide() {
        if (hidePending) {
            handler.removeCallbacks(delayedHide)
            hidePending = false
        }
    }

    private fun screenInUse(): Boolean {
        val power = getSystemService(PowerManager::class.java)
        val keyguard = getSystemService(KeyguardManager::class.java)
        return power.isInteractive && !keyguard.isKeyguardLocked
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (::panel.isInitialized) panel.hide()
        if (::bubble.isInitialized) bubble.hide()
        if (::message.isInitialized) message.hide()
        runCatching { unregisterReceiver(screenReceiver) }
        handler.removeCallbacksAndMessages(null)
        scope.cancel()
        connectedState.value = false
        super.onDestroy()
    }
}
