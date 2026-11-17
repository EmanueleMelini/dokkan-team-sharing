package it.emanuelemelini.dokkants.categoryhelper.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.text.format.DateUtils
import android.widget.Toast
import androidx.core.net.toUri
import it.emanuelemelini.dokkants.categoryhelper.AppInfo
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.settings.AutoCheckRecord
import it.emanuelemelini.dokkants.categoryhelper.update.UpdateResult

/** The snackbar text for a finished "Check for updates" (settings and editor share it). */
internal fun updateMessage(resources: Resources, result: UpdateResult): String = when (result) {
    is UpdateResult.Added -> resources.getQuantityString(R.plurals.update_added, result.categories.size, result.categories.size)
    UpdateResult.UpToDate -> resources.getString(R.string.update_none)
    is UpdateResult.Failed -> when (result.reason) {
        UpdateResult.Reason.NETWORK -> resources.getString(R.string.update_failed_network)
        UpdateResult.Reason.HTTP -> resources.getString(R.string.update_failed_http, result.httpCode)
        UpdateResult.Reason.INVALID -> resources.getString(R.string.update_failed_invalid)
        UpdateResult.Reason.NEWER_FORMAT -> resources.getString(R.string.update_failed_newer)
        UpdateResult.Reason.STORAGE -> resources.getString(R.string.update_failed_storage)
    }
}

/** The message of an automatic check that added categories: named after the app, it shows over the game. */
internal fun autoUpdateMessage(resources: Resources, added: Int): String = resources.getString(
    R.string.auto_update_message,
    resources.getString(R.string.app_name),
    resources.getQuantityString(R.plurals.update_added, added, added),
)

/** The settings line about the last automatic check: when (local date and time) and how it ended. */
internal fun lastAutoCheckText(context: Context, resources: Resources, record: AutoCheckRecord): String {
    val time = DateUtils.formatDateTime(
        context,
        record.atMs,
        DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH,
    )
    val outcome = record.outcome
    return when {
        outcome.failed -> resources.getString(R.string.auto_update_last_failed, time)
        outcome.added > 0 ->
            resources.getQuantityString(R.plurals.auto_update_last_added, outcome.added, time, outcome.added)
        else -> resources.getString(R.string.auto_update_last_up_to_date, time)
    }
}

/** The instructions page on the site, in the browser. */
internal fun openInstructions(context: Context) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, AppInfo.INSTRUCTIONS_URL.toUri()))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, context.getString(R.string.about_no_browser, AppInfo.INSTRUCTIONS_URL), Toast.LENGTH_LONG).show()
    }
}
