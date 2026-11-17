package it.emanuelemelini.dokkants.categoryhelper

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppUpdateState
import it.emanuelemelini.dokkants.categoryhelper.appupdate.AppUpdater
import it.emanuelemelini.dokkants.categoryhelper.ui.AppTheme
import it.emanuelemelini.dokkants.categoryhelper.ui.AppUpdateDialogs
import it.emanuelemelini.dokkants.categoryhelper.ui.SettingsScreen

class MainActivity : ComponentActivity() {

    private val updater by lazy { AppUpdater.get(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) {
            // Opened (not recreated): "What's new" after an update, then the known newer version,
            // then the automatic check of the day
            updater.onMainOpened()
            if (showsAppUpdate(intent)) updater.offerKnown()
        } else if (savedInstanceState.getBoolean(STATE_AWAITING_PERMISSION)) {
            // The process was stopped while the "Install unknown apps" settings were open
            updater.resumeAfterRestart()
        }
        setContent {
            AppTheme {
                SettingsScreen()
                AppUpdateDialogs(updater)
            }
        }
    }

    /** The search panel's "Version X.Y.Z available" row, with this activity already open. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (showsAppUpdate(intent)) updater.offerKnown()
    }

    override fun onStart() {
        super.onStart()
        updater.setMainVisible(true)
    }

    override fun onStop() {
        updater.setMainVisible(false)
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val state = updater.state.value
        outState.putBoolean(STATE_AWAITING_PERMISSION, state is AppUpdateState.NeedsPermission && state.requested)
    }

    companion object {
        /** Opens the update dialog of the known newer version. */
        const val EXTRA_SHOW_APP_UPDATE = "it.emanuelemelini.dokkants.categoryhelper.extra.SHOW_APP_UPDATE"
        private const val STATE_AWAITING_PERMISSION = "awaiting_install_permission"

        /** From the accessibility service: a new task, or the open one brought to the front. */
        fun showAppUpdateIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_SHOW_APP_UPDATE, true)

        /**
         * The panel's row asked for the update dialog. Not when the task comes back from the recent
         * apps: Android delivers the intent that started it again, and the dialog would reopen after Later.
         */
        private fun showsAppUpdate(intent: Intent): Boolean =
            intent.getBooleanExtra(EXTRA_SHOW_APP_UPDATE, false) &&
                (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0
    }
}
