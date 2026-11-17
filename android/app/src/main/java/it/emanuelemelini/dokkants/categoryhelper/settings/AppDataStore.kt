package it.emanuelemelini.dokkants.categoryhelper.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore

/**
 * The app's single Preferences DataStore (settings, recents, favourites): one instance per process,
 * shared by the settings screen and the accessibility service.
 */
internal val Context.appDataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")
