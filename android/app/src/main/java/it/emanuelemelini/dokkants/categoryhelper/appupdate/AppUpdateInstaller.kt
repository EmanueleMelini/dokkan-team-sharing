package it.emanuelemelini.dokkants.categoryhelper.appupdate

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.IntentCompat
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The install session could not be created or opened for writing: Android reserves the size of the
 * APK up front, so this means there is not enough free space (or the storage is unavailable).
 */
class InstallSpaceException(cause: IOException) : IOException(cause.message, cause)

/**
 * Downloads the APK of a release straight into a PackageInstaller session and commits it. Android
 * then asks the user to confirm (the intent arrives in [AppUpdateReceiver]) and refuses an APK with
 * another package name ([targetPackage]) or signed with another key.
 */
class AppUpdateInstaller(private val context: Context, private val targetPackage: String) {

    private val packageInstaller: PackageInstaller get() = context.packageManager.packageInstaller

    /** "Install unknown apps" is allowed for this app in the system settings. */
    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    /**
     * Downloads and commits. [onSession] gets the id of the new session before anything is written
     * (the installer's answers name it); when it returns false the attempt was cancelled meanwhile
     * and the session is dropped. Throws [InstallSpaceException] when the session cannot be created
     * or opened, another IOException when the download fails.
     */
    suspend fun downloadAndInstall(
        release: AppRelease,
        userAgent: String,
        onSession: (Int) -> Boolean,
        onProgress: (Float) -> Unit,
    ) = withContext(Dispatchers.IO) {
        // Sessions of an earlier attempt (cancelled, failed or never confirmed) would stay around
        packageInstaller.mySessions.forEach { abandon(it.sessionId) }

        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            // An APK with another package name is refused
            setAppPackageName(targetPackage)
            setSize(release.apkSize)
            if (Build.VERSION.SDK_INT >= 33) setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
        }
        val sessionId = space { packageInstaller.createSession(params) }
        try {
            if (!onSession(sessionId)) throw CancellationException("the update was cancelled")
            space { packageInstaller.openSession(sessionId) }.use { session ->
                space { session.openWrite(APK_NAME, 0, release.apkSize) }.use { output ->
                    ApkDownload.download(release.apkUrl, userAgent, release.apkSize, output, onProgress)
                    session.fsync(output)
                }
                // Mutable: the installer adds the status and the confirmation intent. Explicit, to a
                // receiver that is not exported. The session id is ours too (the installer adds the
                // same extra, and the PendingIntent's own extras win): the answer names its attempt.
                val status = Intent(context, AppUpdateReceiver::class.java)
                    .putExtra(PackageInstaller.EXTRA_SESSION_ID, sessionId)
                val pending = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    status,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(pending.intentSender)
            }
        } catch (e: Throwable) {
            // Also on cancellation: a half-written session is useless
            abandon(sessionId)
            throw e
        }
    }

    /** Drops a session, also one already committed and waiting for the user (the installer answers ABORTED). */
    fun abandon(sessionId: Int) {
        try {
            packageInstaller.abandonSession(sessionId)
        } catch (e: SecurityException) {
            // Already gone
            DebugLog.w("app update: cannot abandon session $sessionId", e)
        }
    }

    /** The session calls that reserve space: their IOException is a lack of space, not a download error. */
    private inline fun <T> space(block: () -> T): T = try {
        block()
    } catch (e: IOException) {
        throw InstallSpaceException(e)
    }

    private companion object {
        const val APK_NAME = "base.apk"
    }
}

/** The result of the install session: a confirmation to ask, success, cancellation or an error. */
class AppUpdateReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, InstallSessions.NONE)
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION, PackageInstaller.STATUS_SUCCESS ->
                DebugLog.d { "app update: session $sessionId, install status $status" }
            else -> DebugLog.w("app update: session $sessionId, install status $status $message")
        }
        AppUpdater.get(context).onInstallStatus(sessionId, status, confirm)
    }
}
