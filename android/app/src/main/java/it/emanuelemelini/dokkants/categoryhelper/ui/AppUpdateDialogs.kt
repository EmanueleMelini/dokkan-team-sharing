package it.emanuelemelini.dokkants.categoryhelper.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.provider.Settings
import android.text.format.DateUtils
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppCheckResult
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppRelease
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppUpdateError
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppUpdateRecord
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppUpdateState
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppUpdater
import it.emanuelemelini.dokkants.categoryhelper.appupdate.ChangelogEntry
import it.emanuelemelini.dokkants.categoryhelper.appupdate.GitHubReleases
import it.emanuelemelini.dokkants.categoryhelper.appupdate.LatestRelease
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import kotlin.math.roundToInt

/**
 * Over MainActivity: first "What's new" after an update, then the update dialog of a newer version
 * with its permission, download and error dialogs ([AppUpdater.state]).
 */
@Composable
fun AppUpdateDialogs(updater: AppUpdater) {
    val context = LocalContext.current
    val state by updater.state.collectAsStateWithLifecycle()
    val whatsNew by updater.whatsNew.collectAsStateWithLifecycle()

    // Back from the "Install unknown apps" settings
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { updater.onResume() }

    if (whatsNew.isNotEmpty()) {
        WhatsNewDialog(whatsNew, onDismiss = updater::dismissWhatsNew)
        return
    }

    fun openInBrowser() {
        updater.dismiss()
        openUrl(context, GitHubReleases.BROWSER_DOWNLOAD_URL)
    }

    when (val current = state) {
        is AppUpdateState.Offer -> UpdateDialog(
            release = current.release,
            installsReleaseApp = updater.installsReleaseApp,
            installed = remember(current) { updater.installedTargetVersion()?.toString() },
            onUpdate = { updater.install(current.release) },
            onLater = updater::later,
        )

        is AppUpdateState.NeedsPermission -> if (current.denied) {
            AlertDialog(
                onDismissRequest = updater::dismiss,
                title = { Text(stringResource(R.string.app_update_permission_title)) },
                text = { Text(stringResource(R.string.app_update_permission_denied)) },
                confirmButton = {
                    TextButton(onClick = ::openInBrowser) { Text(stringResource(R.string.app_update_browser)) }
                },
                dismissButton = {
                    TextButton(onClick = updater::dismiss) { Text(stringResource(R.string.app_update_close)) }
                },
            )
        } else {
            AlertDialog(
                onDismissRequest = updater::dismiss,
                title = { Text(stringResource(R.string.app_update_permission_title)) },
                text = { Text(stringResource(R.string.app_update_permission_text)) },
                confirmButton = {
                    TextButton(onClick = {
                        updater.onPermissionRequested(current.release)
                        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri())
                        try {
                            context.startActivity(intent)
                        } catch (e: ActivityNotFoundException) {
                            // No such screen on this phone: as if refused
                            DebugLog.w("app update: no unknown sources settings", e)
                            updater.onResume()
                        }
                    }) { Text(stringResource(R.string.app_update_permission_open)) }
                },
                dismissButton = {
                    TextButton(onClick = updater::dismiss) { Text(stringResource(R.string.app_update_cancel)) }
                },
            )
        }

        is AppUpdateState.Downloading -> AlertDialog(
            // Only Cancel stops the download
            onDismissRequest = {},
            properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            title = { Text(stringResource(R.string.app_update_downloading, current.release.version.toString())) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LinearProgressIndicator(progress = { current.progress }, modifier = Modifier.fillMaxWidth())
                    Text(
                        stringResource(R.string.app_update_progress, (current.progress * 100).roundToInt()),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = updater::cancelDownload) { Text(stringResource(R.string.app_update_cancel)) }
            },
        )

        // The system asks to confirm the install: launched from here, while the app is visible
        is AppUpdateState.ConfirmInstall -> LaunchedEffect(current) {
            try {
                context.startActivity(current.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: ActivityNotFoundException) {
                DebugLog.w("app update: no installer to confirm", e)
            }
            updater.onConfirmLaunched()
        }

        is AppUpdateState.Installed -> AlertDialog(
            onDismissRequest = updater::dismiss,
            title = { Text(stringResource(R.string.app_update_installed, current.version?.toString() ?: "?")) },
            confirmButton = {
                TextButton(onClick = updater::dismiss) { Text(stringResource(R.string.app_update_close)) }
            },
        )

        is AppUpdateState.Failed -> AlertDialog(
            onDismissRequest = updater::dismiss,
            title = { Text(stringResource(R.string.app_update_failed_title)) },
            text = {
                Text(
                    stringResource(
                        when (current.error) {
                            AppUpdateError.DOWNLOAD -> R.string.app_update_error_download
                            AppUpdateError.CONFLICT -> R.string.app_update_error_conflict
                            AppUpdateError.STORAGE -> R.string.app_update_error_storage
                            AppUpdateError.INSTALL -> R.string.app_update_error_install
                        },
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = ::openInBrowser) { Text(stringResource(R.string.app_update_browser)) }
            },
            dismissButton = {
                TextButton(onClick = updater::dismiss) { Text(stringResource(R.string.app_update_close)) }
            },
        )

        AppUpdateState.Idle -> Unit
    }
}

/** The new version, its notes in the app language, Update and Later. */
@Composable
private fun UpdateDialog(
    release: AppRelease,
    installsReleaseApp: Boolean,
    installed: String?,
    onUpdate: () -> Unit,
    onLater: () -> Unit,
) {
    val notes = release.notes.forLanguage(stringResource(R.string.notes_language))
    AlertDialog(
        // Back or a tap outside: like Later
        onDismissRequest = onLater,
        title = { Text(stringResource(R.string.app_update_title, release.version.toString())) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                if (installsReleaseApp) {
                    Text(stringResource(R.string.app_update_debug_hint), color = MaterialTheme.colorScheme.error)
                }
                if (installed != null) Text(stringResource(R.string.app_update_current, installed))
                notes.forEach { NoteRow(it) }
            }
        },
        confirmButton = {
            TextButton(onClick = onUpdate) {
                Text(stringResource(if (installsReleaseApp) R.string.app_update_install_release else R.string.app_update_update))
            }
        },
        dismissButton = {
            TextButton(onClick = onLater) { Text(stringResource(R.string.app_update_later)) }
        },
    )
}

/** "What's new": the notes of each version, newest first, in the app language. */
@Composable
private fun WhatsNewDialog(entries: List<ChangelogEntry>, onDismiss: () -> Unit) {
    val language = stringResource(R.string.notes_language)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.whats_new)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                entries.forEach { entry ->
                    Text(
                        stringResource(R.string.about_version, entry.version.toString()),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    entry.notes.forLanguage(language).forEach { NoteRow(it) }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.app_update_close)) }
        },
    )
}

/** One bullet of release notes. */
@Composable
private fun NoteRow(note: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("•", style = MaterialTheme.typography.bodyMedium)
        Text(note, style = MaterialTheme.typography.bodyMedium)
    }
}

/** The settings line about the last check of the app version, or null before the first. */
internal fun appUpdateStatusText(context: Context, resources: Resources, record: AppUpdateRecord, newer: AppRelease?): String? {
    val at = record.checkedAtMs ?: return null
    val time = DateUtils.formatDateTime(
        context,
        at,
        DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH,
    )
    return when {
        newer != null -> resources.getString(R.string.app_update_status_available, time, newer.version.toString())
        record.checkFailed -> resources.getString(R.string.app_update_status_failed, time)
        else -> resources.getString(R.string.app_update_status_up_to_date, time)
    }
}

/** The snackbar text of "Check for app updates"; null when the update dialog shows instead. */
internal fun appCheckMessage(resources: Resources, result: AppCheckResult): String? = when (result) {
    is AppCheckResult.Available -> null
    AppCheckResult.UpToDate -> resources.getString(R.string.app_update_none)
    is AppCheckResult.Failed -> when (result.reason) {
        LatestRelease.Reason.NETWORK -> resources.getString(R.string.app_update_failed_network)
        LatestRelease.Reason.HTTP -> resources.getString(R.string.app_update_failed_http, result.httpCode)
        LatestRelease.Reason.INVALID -> resources.getString(R.string.app_update_failed_invalid)
    }
}

/** A page or file in the browser. */
internal fun openUrl(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, context.getString(R.string.about_no_browser, url), Toast.LENGTH_LONG).show()
    }
}
