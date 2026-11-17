package it.emanuelemelini.dokkants.categoryhelper

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import it.emanuelemelini.dokkants.categoryhelper.ui.AppTheme
import it.emanuelemelini.dokkants.categoryhelper.ui.DictionaryScreen

/** Dictionary editor: add, edit, delete categories; import/export JSON. */
class DictionaryActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AppTheme {
                DictionaryScreen(onBack = ::finish)
            }
        }
    }
}
