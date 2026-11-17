package it.emanuelemelini.dokkants.categoryhelper.dictionary

import android.annotation.SuppressLint
import android.content.Context
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * The category dictionary, shared by the service (search panel) and the editor: one instance per
 * process, so edits show up in the panel at once.
 *
 * `assets/categories.json` is copied to internal storage on first use. While the stored copy has
 * never been changed in the app, a bundled dictionary with a higher `version` replaces it; after
 * the first edit or import (marker file) the bundled one is ignored until "restore" is used.
 *
 * Categories added by "Update categories" ([addNew]) do not set the marker: they only add what
 * the game data has and the dictionary lacks, so an unedited dictionary stays unedited (a newer
 * bundled one, built from the same game data, can still replace it) and an edited one stays
 * edited. "Restore" drops them like everything else; the next check adds them back.
 *
 * The game ids the user removed (deleted, or left out of a "Replace" import) are saved apart, in
 * `categories.removed`, so the check does not add them back; "Restore" forgets them. Entries
 * without a game id get the one of the bundled entry with the same slug ([StoredDictionary]).
 */
class DictionaryRepository private constructor(private val context: Context) {

    private val state = MutableStateFlow<CategoryDictionary?>(null)
    private val editedState = MutableStateFlow(false)
    private val mutex = Mutex()

    // Guarded by the mutex, set by load() and restoreBundled()
    private var bundled: List<Category> = emptyList()
    private var removed: Set<Int> = emptySet()

    /** Null until loaded (see [ensureLoaded]). */
    val dictionary: StateFlow<CategoryDictionary?> = state.asStateFlow()

    /** The dictionary was changed in the app (edit or import). */
    val edited: StateFlow<Boolean> = editedState.asStateFlow()

    private val file: File get() = File(context.filesDir, FILE_NAME)
    private val editedMarker: File get() = File(context.filesDir, EDITED_MARKER)
    private val removedFile: File get() = File(context.filesDir, REMOVED_FILE)

    suspend fun ensureLoaded() {
        mutex.withLock {
            if (state.value == null) withContext(Dispatchers.IO) { load() }
        }
    }

    /** Adds the category, or replaces the one with the same id. */
    suspend fun upsert(category: Category) = change { current ->
        val index = current.categories.indexOfFirst { it.id == category.id }
        val categories = if (index >= 0) {
            current.categories.toMutableList().also { it[index] = category }
        } else {
            current.categories + category
        }
        current.copy(categories = categories)
    }

    suspend fun delete(id: String) = change { current ->
        current.copy(categories = current.categories.filterNot { it.id == id })
    }

    /** Import: [merge] keeps the current entries (see [DictionaryFormat.merge]), else they are replaced. */
    suspend fun import(imported: CategoryDictionary, merge: Boolean) = change { current ->
        if (merge) {
            current.copy(categories = DictionaryFormat.merge(current.categories, imported.categories))
        } else {
            imported.copy(version = maxOf(current.version, imported.version))
        }
    }

    /**
     * The update check (the button or the automatic one): appends the categories [pick] chooses
     * given the current ones and the removed game ids, under the same lock as edits, so an edit
     * made meanwhile is never overwritten. Existing entries are never changed or removed and the
     * edited marker is left as it is. Returns what was added.
     * @throws java.io.IOException if the dictionary cannot be saved (nothing is added then).
     */
    suspend fun addNew(pick: (local: List<Category>, removed: Set<Int>) -> List<Category>): List<Category> {
        ensureLoaded()
        return mutex.withLock {
            val current = state.value ?: return@withLock emptyList()
            val added = pick(current.categories, removed)
            if (added.isNotEmpty()) {
                val updated = current.copy(categories = current.categories + added)
                // Once the file is written the state must follow, or the next edit would drop what
                // was just added. The caller's scope (the service, a settings screen) can be
                // cancelled meanwhile: the block is not cancellable, and the state is set inside it
                // because returning from it to another dispatcher would throw at once
                withContext(Dispatchers.IO + NonCancellable) {
                    writeAtomically(file, DictionaryFormat.encode(updated))
                    state.value = updated
                }
            }
            added
        }
    }

    /** Back to the dictionary bundled with the app; in-app changes are lost. */
    suspend fun restoreBundled() {
        mutex.withLock {
            withContext(Dispatchers.IO) {
                val text = bundledText()
                writeAtomically(file, text)
                editedMarker.delete()
                removedFile.delete()
                removed = emptySet()
                val restored = DictionaryFormat.parse(text).dictionary
                bundled = restored.categories
                state.value = restored
                editedState.value = false
            }
        }
    }

    suspend fun exportJson(): String {
        ensureLoaded()
        return DictionaryFormat.encode(state.value ?: CategoryDictionary())
    }

    private suspend fun change(transform: (CategoryDictionary) -> CategoryDictionary) {
        ensureLoaded()
        mutex.withLock {
            val current = state.value ?: return
            val changed = transform(current)
            val updated = changed.copy(categories = StoredDictionary.withBundledGameIds(changed.categories, bundled))
            val nowRemoved = StoredDictionary.removedAfter(removed, current.categories, updated.categories)
            withContext(Dispatchers.IO) {
                writeAtomically(file, DictionaryFormat.encode(updated))
                // Always written once edited: a 0.4.0 dictionary gets its removed ids saved here
                writeAtomically(removedFile, StoredDictionary.encodeRemoved(nowRemoved))
                editedMarker.createNewFile()
            }
            state.value = updated
            removed = nowRemoved
            editedState.value = true
        }
    }

    private fun load() {
        val edited = editedMarker.exists()
        val stored = if (file.exists()) {
            runCatching { DictionaryFormat.parse(file.readText()).dictionary }
                .onFailure {
                    DebugLog.w("stored dictionary unreadable, kept as $BACKUP_NAME", it)
                    file.renameTo(File(context.filesDir, BACKUP_NAME))
                    editedMarker.delete()
                }
                .getOrNull()
        } else {
            null
        }

        val bundledText = bundledText()
        val bundledDictionary = DictionaryFormat.parse(bundledText).dictionary
        bundled = bundledDictionary.categories
        if (stored != null && StoredDictionary.keepStored(stored, edited, bundledDictionary)) {
            val filled = StoredDictionary.withBundledGameIds(stored.categories, bundled)
            removed = if (removedFile.exists()) {
                runCatching { StoredDictionary.parseRemoved(removedFile.readText()) }.getOrDefault(emptySet())
            } else {
                StoredDictionary.initialRemoved(stored, filled)
            }
            setLoaded(stored.copy(categories = filled), edited)
            return
        }
        DebugLog.d { "installing bundled dictionary v${bundledDictionary.version} (stored: v${stored?.version})" }
        writeAtomically(file, bundledText)
        removedFile.delete()
        removed = emptySet()
        setLoaded(bundledDictionary, edited = false)
    }

    private fun setLoaded(dictionary: CategoryDictionary, edited: Boolean) {
        state.value = dictionary
        editedState.value = edited
    }

    private fun bundledText(): String =
        context.assets.open(FILE_NAME).bufferedReader().use { it.readText() }

    private fun writeAtomically(target: File, text: String) {
        val temp = File(target.parentFile, "${target.name}.tmp")
        temp.writeText(text)
        if (!temp.renameTo(target)) {
            target.writeText(text)
            temp.delete()
        }
    }

    companion object {
        private const val FILE_NAME = "categories.json"
        private const val BACKUP_NAME = "categories.unreadable.json"
        private const val EDITED_MARKER = "categories.edited"
        private const val REMOVED_FILE = "categories.removed"

        // Holds only the application context: no leak
        @SuppressLint("StaticFieldLeak")
        @Volatile
        private var instance: DictionaryRepository? = null

        fun get(context: Context): DictionaryRepository =
            instance ?: synchronized(this) {
                instance ?: DictionaryRepository(context.applicationContext).also { instance = it }
            }
    }
}
