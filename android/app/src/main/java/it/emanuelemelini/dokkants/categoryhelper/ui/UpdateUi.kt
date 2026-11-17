package it.emanuelemelini.dokkants.categoryhelper.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.res.Resources
import android.widget.Toast
import androidx.core.net.toUri
import it.emanuelemelini.dokkants.categoryhelper.AppInfo
import it.emanuelemelini.dokkants.categoryhelper.R
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

/** The instructions page on the site, in the browser. */
internal fun openInstructions(context: Context) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, AppInfo.INSTRUCTIONS_URL.toUri()))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, context.getString(R.string.about_no_browser, AppInfo.INSTRUCTIONS_URL), Toast.LENGTH_LONG).show()
    }
}
