package it.emanuelemelini.dokkants.categoryhelper.appupdate

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import it.emanuelemelini.dokkants.categoryhelper.AppInfo
import it.emanuelemelini.dokkants.categoryhelper.BuildConfig
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import it.emanuelemelini.dokkants.categoryhelper.settings.SettingsRepository
import it.emanuelemelini.dokkants.categoryhelper.update.UpdateCheck
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.floor
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Why an update could not be installed; the UI picks the text. */
enum class AppUpdateError {
    /** The download did not finish (network, size, a refused URL). */
    DOWNLOAD,

    /** Android refused it as a conflict with the installed app: signed with another key, for example. */
    CONFLICT,

    /** Not enough space to install: the session could not be created, or Android said so. */
    STORAGE,

    /** Any other installer error. */
    INSTALL,
}

/** The update dialogs of MainActivity follow this state. */
sealed interface AppUpdateState {
    data object Idle : AppUpdateState

    /** The update dialog: the version, its notes, Update and Later. */
    data class Offer(val release: AppRelease) : AppUpdateState

    /** "Install unknown apps" is off: [requested] while its system settings are open, [denied] after. */
    data class NeedsPermission(val release: AppRelease, val requested: Boolean = false, val denied: Boolean = false) :
        AppUpdateState

    /** [progress] 0..1. */
    data class Downloading(val release: AppRelease, val progress: Float) : AppUpdateState

    /** The system confirmation, launched by the visible activity (a start from the background may be blocked). */
    data class ConfirmInstall(val intent: Intent) : AppUpdateState

    /** Debug builds only: the release app was installed. A release build is replaced instead (Android stops its process). */
    data class Installed(val version: AppVersion?) : AppUpdateState

    data class Failed(val error: AppUpdateError) : AppUpdateState
}

/** The answer to "Check for app updates". */
sealed interface AppCheckResult {
    data class Available(val release: AppRelease) : AppCheckResult
    data object UpToDate : AppCheckResult
    data class Failed(val reason: LatestRelease.Reason, val httpCode: Int) : AppCheckResult
}

/**
 * The app's updates from GitHub Releases: the check (automatic or manual), the dialogs' state, the
 * download into a PackageInstaller session, "What's new". One instance per process, shared by
 * MainActivity, the accessibility service and the install receiver; the state lives here because
 * the installer answers through a receiver, and a download outlives a rotation.
 *
 * In a debug build (another package, ".debug", signed with the debug key) the app cannot update
 * itself from GitHub: the same flow installs the release app instead ([targetPackage]), so the
 * install can be tried, and the automatic check never runs.
 */
class AppUpdater private constructor(private val context: Context) {

    private val store = AppUpdateStore(context)
    private val settings = SettingsRepository(context)
    // Lives as long as the process; an unexpected error (the DataStore, the installer) is logged, never a crash
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate + CoroutineExceptionHandler { _, e -> DebugLog.w("app update failed", e) },
    )
    private val checkMutex = Mutex()

    private val stateFlow = MutableStateFlow<AppUpdateState>(AppUpdateState.Idle)
    val state: StateFlow<AppUpdateState> = stateFlow.asStateFlow()

    private val checkingFlow = MutableStateFlow(false)

    /** A check of the app version is running, manual or automatic (the record says "failed" until it ends). */
    val checking: StateFlow<Boolean> = checkingFlow.asStateFlow()

    /** The checks running now (a manual one can wait for the automatic one); main thread only. */
    private var checksRunning = 0

    private val whatsNewFlow = MutableStateFlow<List<ChangelogEntry>>(emptyList())

    /** The notes "What's new" shows now, newest first; empty when there is no dialog. */
    val whatsNew: StateFlow<List<ChangelogEntry>> = whatsNewFlow.asStateFlow()

    val record: Flow<AppUpdateRecord> = store.record

    /** The debug build installs the release app (another app); a release build updates itself. */
    val installsReleaseApp: Boolean = BuildConfig.DEBUG

    /** The package the downloaded APK must have: this app, or the release app in a debug build. */
    val targetPackage: String = if (installsReleaseApp) BuildConfig.RELEASE_APPLICATION_ID else context.packageName

    private val installer = AppUpdateInstaller(context, targetPackage)

    /** The install session of the current attempt: the answers about any other one are ignored. */
    private val sessions = InstallSessions()

    private val userAgent: String by lazy { UpdateCheck.userAgent(AppInfo.versionName(context)) }

    private var autoCheck: Job? = null
    private var download: Job? = null

    /** The release of the current attempt, for the answer of the installer. */
    private var installing: AppRelease? = null

    /** MainActivity is started: only then may a check found by the automatic check open the dialog. */
    private var mainVisible = false

    /** The version of [targetPackage] on the phone; null when it is not installed (debug only). */
    fun installedTargetVersion(): AppVersion? =
        AppInfo.packageInfo(context, targetPackage)?.versionName?.let(AppVersion::parse)
            ?: if (installsReleaseApp) null else AppVersion.parse(BuildConfig.VERSION_NAME)

    /** The release whose dialog opens by itself now (at start, after an automatic check), by [AppUpdatePolicy.offered]. */
    fun offered(record: AppUpdateRecord, nowMs: Long = System.currentTimeMillis()): AppRelease? =
        AppUpdatePolicy.offered(record.latest, installedTargetVersion(), nowMs, record.laterUntilMs)

    /** A known release newer than the installed one, "Later" or not (the bubble's dot, the panel's row, the settings line). */
    fun newer(record: AppUpdateRecord): AppRelease? =
        AppUpdatePolicy.available(record.latest, installedTargetVersion())

    fun setMainVisible(visible: Boolean) {
        mainVisible = visible
    }

    /**
     * The automatic check: release builds only, at most once a day ([AppUpdatePolicy.due], the switch
     * "Check automatically"). From the accessibility service when Dokkan comes to the front and from
     * MainActivity when it opens. Silent: a newer version shows as the bubble's dot and the panel's
     * row, and as the dialog if MainActivity is open.
     */
    fun checkAutomaticallyIfDue() {
        if (installsReleaseApp || autoCheck?.isActive == true) return
        // Dispatched: the caller (an accessibility event, onCreate) returns first
        autoCheck = scope.launch(Dispatchers.Main) {
            try {
                val enabled = settings.settings.first().autoUpdate
                val before = store.record.first()
                val now = System.currentTimeMillis()
                if (!AppUpdatePolicy.due(now, before.checkedAtMs, before.checkFailed, enabled, releaseBuild = true)) {
                    return@launch
                }
                val result = whileChecking { checkMutex.withLock { check(now) } }
                DebugLog.d { "automatic app update check: $result" }
                val offered = offered(store.record.first())
                // After "What's new", if that is open: the dialogs show it first
                if (offered != null && mainVisible && stateFlow.value == AppUpdateState.Idle) {
                    stateFlow.value = AppUpdateState.Offer(offered)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                DebugLog.w("automatic app update check failed", e)
            }
        }
    }

    /** "Check for app updates", in every build. A newer version opens the update dialog ("Later" or not). */
    suspend fun checkNow(): AppCheckResult = scope.async {
        val result = try {
            whileChecking { checkMutex.withLock { check(System.currentTimeMillis()) } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The settings could not be written, for example
            DebugLog.w("app update check failed", e)
            LatestRelease.Failed(LatestRelease.Reason.INVALID)
        }
        when (result) {
            is LatestRelease.Found -> if (AppUpdatePolicy.isNewer(result.release.version, installedTargetVersion())) {
                if (stateFlow.value == AppUpdateState.Idle) stateFlow.value = AppUpdateState.Offer(result.release)
                AppCheckResult.Available(result.release)
            } else {
                AppCheckResult.UpToDate
            }
            LatestRelease.NoRelease -> AppCheckResult.UpToDate
            is LatestRelease.Failed -> AppCheckResult.Failed(result.reason, result.httpCode)
        }
    }.await()

    /** [checking] is true while [block] runs; set at once, also while a manual check waits for the automatic one. */
    private suspend fun <T> whileChecking(block: suspend () -> T): T {
        checksRunning++
        checkingFlow.value = true
        try {
            return block()
        } finally {
            checksRunning--
            checkingFlow.value = checksRunning > 0
        }
    }

    /** One request, recorded as failed until it finishes (an interrupted check is retried after an hour). */
    private suspend fun check(nowMs: Long): LatestRelease {
        store.recordCheckAttempt(nowMs)
        val result = GitHubReleases.fetchLatest(GitHubReleases.LATEST_URL, userAgent)
        store.recordCheckOutcome(result)
        DebugLog.d { "app update check: $result" }
        return result
    }

    /**
     * MainActivity has just opened (not recreated): "What's new" after an update, then the dialog of a
     * known newer version, then the automatic check of the day. On this scope, so an error (the
     * settings cannot be written, for example) is logged and never closes the app.
     */
    fun onMainOpened() {
        scope.launch {
            try {
                loadWhatsNew()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                DebugLog.w("what's new failed", e)
            }
            offerAtStart()
            checkAutomaticallyIfDue()
        }
    }

    /** The dialog of a known newer version, unless "Later" holds. */
    private suspend fun offerAtStart() {
        val offered = offered(store.record.first()) ?: return
        if (stateFlow.value == AppUpdateState.Idle) stateFlow.value = AppUpdateState.Offer(offered)
    }

    /** The user asked for it (the panel's row, the settings): the dialog of a known newer version, even after "Later". */
    fun offerKnown() {
        scope.launch {
            val release = newer(store.record.first()) ?: return@launch
            val current = stateFlow.value
            if (current == AppUpdateState.Idle || current is AppUpdateState.Offer || current is AppUpdateState.Failed) {
                stateFlow.value = AppUpdateState.Offer(release)
            }
        }
    }

    /** "Later": the dialog closes, and the dot, the row and the dialog at start wait a day. */
    fun later() {
        val now = System.currentTimeMillis()
        scope.launch { store.setLaterUntil(AppUpdatePolicy.laterUntil(now)) }
        if (stateFlow.value !is AppUpdateState.Downloading) stateFlow.value = AppUpdateState.Idle
    }

    /** Closes an error or the "installed" dialog. */
    fun dismiss() {
        if (stateFlow.value !is AppUpdateState.Downloading) stateFlow.value = AppUpdateState.Idle
    }

    /** "Update": straight to the download when this app may install apps. */
    fun install(release: AppRelease) {
        if (installer.canInstall()) startDownload(release) else stateFlow.value = AppUpdateState.NeedsPermission(release)
    }

    /** The system settings for "Install unknown apps" are being opened. */
    fun onPermissionRequested(release: AppRelease) {
        stateFlow.value = AppUpdateState.NeedsPermission(release, requested = true)
    }

    /** Back from those settings: download if the permission was granted. */
    fun onResume() {
        val current = stateFlow.value
        if (current is AppUpdateState.NeedsPermission && current.requested) {
            if (installer.canInstall()) {
                startDownload(current.release)
            } else {
                stateFlow.value = current.copy(requested = false, denied = true)
            }
        }
    }

    /**
     * MainActivity was recreated while the permission settings were open, in a new process (Android
     * may stop the app while it is in the background): continue with the known release.
     */
    fun resumeAfterRestart() {
        scope.launch {
            if (stateFlow.value != AppUpdateState.Idle) return@launch
            val release = newer(store.record.first()) ?: return@launch
            stateFlow.value = AppUpdateState.NeedsPermission(release, requested = true)
            onResume()
        }
    }

    /**
     * Cancel, while the dialog shows the download: the job stops and its session is abandoned, also
     * when it was already committed (at 100%, before the installer answered), so no confirmation follows.
     */
    fun cancelDownload() {
        sessions.cancel()?.let(installer::abandon)
        download?.cancel()
        download = null
        stateFlow.value = AppUpdateState.Idle
    }

    /** The confirmation was shown to the user: the answer comes through [onInstallStatus]. */
    fun onConfirmLaunched() {
        if (stateFlow.value is AppUpdateState.ConfirmInstall) stateFlow.value = AppUpdateState.Idle
    }

    /**
     * From [AppUpdateReceiver]. Only the answers about the current attempt's session count: an
     * abandoned session (an earlier attempt, Cancel) answers ABORTED later, and that must not close
     * the dialog of the download running now. On success Android replaces a release build and stops
     * its process.
     */
    fun onInstallStatus(sessionId: Int, status: Int, confirm: Intent?) {
        if (!sessions.accept(sessionId, ends = status != PackageInstaller.STATUS_PENDING_USER_ACTION)) {
            DebugLog.d { "app update: status $status of session $sessionId ignored, not the current attempt" }
            return
        }
        stateFlow.value = when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION ->
                confirm?.let { AppUpdateState.ConfirmInstall(it) } ?: AppUpdateState.Failed(AppUpdateError.INSTALL)
            PackageInstaller.STATUS_SUCCESS ->
                if (installsReleaseApp) AppUpdateState.Installed(installing?.version) else AppUpdateState.Idle
            // The user said no to the confirmation
            PackageInstaller.STATUS_FAILURE_ABORTED -> AppUpdateState.Idle
            PackageInstaller.STATUS_FAILURE_CONFLICT -> AppUpdateState.Failed(AppUpdateError.CONFLICT)
            PackageInstaller.STATUS_FAILURE_STORAGE -> AppUpdateState.Failed(AppUpdateError.STORAGE)
            else -> AppUpdateState.Failed(AppUpdateError.INSTALL)
        }
    }

    private fun startDownload(release: AppRelease) {
        val attempt = sessions.begin()
        installing = release
        download?.cancel()
        // Before the job starts, so that its progress and errors are not overwritten
        stateFlow.value = AppUpdateState.Downloading(release, progress = 0f)
        download = scope.launch {
            try {
                installer.downloadAndInstall(
                    release,
                    userAgent,
                    onSession = { sessionId -> sessions.created(attempt, sessionId) },
                ) { progress ->
                    // Whole percent steps: about a hundred updates for the dialog
                    val step = floor(progress * 100f) / 100f
                    if (sessions.isCurrent(attempt)) {
                        stateFlow.update {
                            if (it is AppUpdateState.Downloading && it.release == release && it.progress != step) it.copy(progress = step) else it
                        }
                    }
                }
                DebugLog.d { "app update: ${release.version} committed to the installer" }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A cancelled or replaced attempt fails on its abandoned session: not the user's concern now
                if (!sessions.isCurrent(attempt)) {
                    DebugLog.d { "app update: an earlier attempt ended ($e)" }
                    return@launch
                }
                DebugLog.w("app update: install failed", e)
                stateFlow.value = when (e) {
                    is InstallSpaceException -> AppUpdateState.Failed(AppUpdateError.STORAGE)
                    // The permission was taken back in the meantime
                    is SecurityException -> AppUpdateState.NeedsPermission(release, denied = true)
                    // IOException: the download (network, size, a refused URL); anything else, the session
                    else -> AppUpdateState.Failed(AppUpdateError.DOWNLOAD)
                }
            }
        }
    }

    /** MainActivity has just opened: the notes of the versions installed since the last time. */
    private suspend fun loadWhatsNew() {
        val current = AppVersion.parse(BuildConfig.VERSION_NAME) ?: return
        val (seenCode, seenVersion) = store.lastSeen()
        val entries = Changelog.entries(context)
        val versions = WhatsNewPolicy.pending(
            lastSeenCode = seenCode,
            lastSeenVersion = seenVersion,
            currentCode = BuildConfig.VERSION_CODE,
            current = current,
            freshInstall = Changelog.isFreshInstall(context),
            bundled = entries.map { it.version },
        ).toSet()
        val shown = entries.filter { it.version in versions && !it.notes.isEmpty }
        if (shown.isNotEmpty()) {
            whatsNewFlow.value = shown
        } else if (seenCode != BuildConfig.VERSION_CODE) {
            // Nothing to show (a fresh install, for example): seen now, there is no dialog to close
            scope.launch { store.setLastSeen(BuildConfig.VERSION_CODE, current) }
        }
    }

    /** "What's new" in the settings: the notes of every version. */
    fun showAllNotes() {
        scope.launch { whatsNewFlow.value = Changelog.entries(context).filter { !it.notes.isEmpty } }
    }

    fun dismissWhatsNew() {
        whatsNewFlow.value = emptyList()
        val current = AppVersion.parse(BuildConfig.VERSION_NAME) ?: return
        scope.launch { store.setLastSeen(BuildConfig.VERSION_CODE, current) }
    }

    companion object {
        // Holds only the application context: no leak
        @SuppressLint("StaticFieldLeak")
        @Volatile
        private var instance: AppUpdater? = null

        fun get(context: Context): AppUpdater =
            instance ?: synchronized(this) {
                instance ?: AppUpdater(context.applicationContext).also { instance = it }
            }
    }
}
