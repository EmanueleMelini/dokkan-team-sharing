package it.emanuelemelini.dokkants.categoryhelper.history

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import it.emanuelemelini.dokkants.categoryhelper.settings.appDataStore
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/** Recently selected and favourite categories, by id. */
class HistoryRepository(context: Context) {
    private val store = context.applicationContext.appDataStore

    private val data: Flow<Preferences> = store.data
        .catch { error -> if (error is IOException) emit(emptyPreferences()) else throw error }

    /** Most recent first. */
    val recents: Flow<List<String>> = data.map { decodeRecents(it[RECENTS]) }.distinctUntilChanged()

    val favorites: Flow<Set<String>> = data.map { it[FAVORITES] ?: emptySet() }.distinctUntilChanged()

    suspend fun addRecent(id: String) {
        store.edit { prefs ->
            val updated = (listOf(id) + decodeRecents(prefs[RECENTS]).filter { it != id }).take(MAX_RECENTS)
            prefs[RECENTS] = updated.joinToString(SEPARATOR)
        }
    }

    suspend fun clearRecents() {
        store.edit { it.remove(RECENTS) }
    }

    /** A deleted category leaves recents and favourites. */
    suspend fun forget(id: String) = retain { it != id }

    /** After an import or a restore: drop ids that are no longer in the dictionary. */
    suspend fun retainOnly(ids: Set<String>) = retain { it in ids }

    private suspend fun retain(keep: (String) -> Boolean) {
        store.edit { prefs ->
            prefs[RECENTS] = decodeRecents(prefs[RECENTS]).filter(keep).joinToString(SEPARATOR)
            prefs[FAVORITES] = (prefs[FAVORITES] ?: emptySet()).filter(keep).toSet()
        }
    }

    suspend fun toggleFavorite(id: String) {
        store.edit { prefs ->
            val current = prefs[FAVORITES] ?: emptySet()
            prefs[FAVORITES] = if (id in current) current - id else current + id
        }
    }

    private fun decodeRecents(value: String?): List<String> =
        value?.split(SEPARATOR)?.filter { it.isNotEmpty() } ?: emptyList()

    private companion object {
        const val MAX_RECENTS = 10

        /** Ids are slugs, they never contain a line break. */
        const val SEPARATOR = "\n"

        val RECENTS = stringPreferencesKey("recent_category_ids")
        val FAVORITES = stringSetPreferencesKey("favorite_category_ids")
    }
}
