package it.emanuelemelini.dokkants.categoryhelper.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryFormat
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryRepository
import it.emanuelemelini.dokkants.categoryhelper.history.HistoryRepository
import it.emanuelemelini.dokkants.categoryhelper.search.CategorySearch
import it.emanuelemelini.dokkants.categoryhelper.update.UpdateCheck
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Which category the edit dialog is open for; [category] null = a new one. */
private data class EditRequest(val category: Category?)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DictionaryScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val repository = remember { DictionaryRepository.get(context) }
    val history = remember { HistoryRepository(context) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { repository.ensureLoaded() }

    val dictionary by repository.dictionary.collectAsStateWithLifecycle()
    val edited by repository.edited.collectAsStateWithLifecycle()
    val categories = dictionary?.categories.orEmpty()

    var query by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<EditRequest?>(null) }
    var pendingImport by remember { mutableStateOf<DictionaryFormat.ParseResult?>(null) }
    var confirmRestore by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var checking by remember { mutableStateOf(false) }

    val shown = remember(query, categories) {
        if (query.isBlank()) {
            categories.sortedBy { it.en.lowercase(Locale.ROOT) }
        } else {
            CategorySearch.search(query, categories, limit = Int.MAX_VALUE)
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val result = runCatching { writeText(context, uri, repository.exportJson()) }
            snackbar.showSnackbar(
                result.fold(
                    onSuccess = { resources.getString(R.string.export_done) },
                    onFailure = { resources.getString(R.string.export_failed, it.message ?: it.javaClass.simpleName) },
                ),
            )
        }
    }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching { DictionaryFormat.parse(readText(context, uri)) }
                .onSuccess { parsed ->
                    if (parsed.dictionary.categories.isEmpty()) {
                        snackbar.showSnackbar(resources.getString(R.string.import_none))
                    } else {
                        pendingImport = parsed
                    }
                }
                .onFailure {
                    snackbar.showSnackbar(
                        resources.getString(R.string.import_invalid, it.message ?: it.javaClass.simpleName),
                    )
                }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.editor_title))
                        Text(
                            pluralStringResource(
                                if (edited) R.plurals.editor_subtitle_edited else R.plurals.editor_subtitle_bundled,
                                categories.size,
                                categories.size,
                            ),
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.editor_back))
                    }
                },
                actions = {
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.editor_menu))
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text(stringResource(if (checking) R.string.update_checking else R.string.update_check)) },
                                enabled = !checking,
                                onClick = {
                                    menuOpen = false
                                    checking = true
                                    scope.launch {
                                        val result = try {
                                            UpdateCheck.run(context)
                                        } finally {
                                            checking = false
                                        }
                                        snackbar.showSnackbar(updateMessage(resources, result))
                                    }
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.editor_import)) },
                                onClick = {
                                    menuOpen = false
                                    // Some file managers label .json files as text or binary
                                    importLauncher.launch(arrayOf("application/json", "text/*", "application/octet-stream"))
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.editor_export)) },
                                onClick = {
                                    menuOpen = false
                                    val date = SimpleDateFormat("yyyyMMdd", Locale.ROOT).format(Date())
                                    exportLauncher.launch("dokkan-categories-$date.json")
                                },
                            )
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.editor_restore)) },
                                onClick = {
                                    menuOpen = false
                                    confirmRestore = true
                                },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { editing = EditRequest(null) }) {
                Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.editor_add))
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (checking) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text(stringResource(R.string.editor_search)) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                trailingIcon = if (query.isNotEmpty()) {
                    {
                        IconButton(onClick = { query = "" }) {
                            Icon(Icons.Filled.Clear, contentDescription = stringResource(R.string.panel_clear))
                        }
                    }
                } else {
                    null
                },
                singleLine = true,
            )
            when {
                dictionary == null -> Unit
                categories.isEmpty() -> EmptyText(stringResource(R.string.editor_empty))
                shown.isEmpty() -> EmptyText(stringResource(R.string.editor_no_results, query.trim()))
                else -> LazyColumn(contentPadding = PaddingValues(bottom = 88.dp)) {
                    items(shown, key = { it.id }) { category ->
                        EditorRow(category) { editing = EditRequest(category) }
                        HorizontalDivider()
                    }
                }
            }
        }
    }

    editing?.let { request ->
        key(request) {
            CategoryEditDialog(
                initial = request.category,
                existing = categories,
                onDismiss = { editing = null },
                onSave = { category ->
                    editing = null
                    scope.launch { repository.upsert(category) }
                },
                onDelete = { category ->
                    editing = null
                    scope.launch {
                        repository.delete(category.id)
                        val result = snackbar.showSnackbar(
                            message = resources.getString(R.string.deleted, category.en),
                            actionLabel = resources.getString(R.string.undo),
                            duration = SnackbarDuration.Short,
                        )
                        if (result == SnackbarResult.ActionPerformed) {
                            repository.upsert(category)
                        } else {
                            history.forget(category.id)
                        }
                    }
                },
            )
        }
    }

    pendingImport?.let { parsed ->
        ImportDialog(
            parsed = parsed,
            currentCount = categories.size,
            onDismiss = { pendingImport = null },
            onImport = { merge ->
                pendingImport = null
                scope.launch {
                    repository.import(parsed.dictionary, merge)
                    repository.dictionary.value?.let { now -> history.retainOnly(now.categories.map { it.id }.toSet()) }
                    snackbar.showSnackbar(resources.getString(R.string.import_done, parsed.dictionary.categories.size))
                }
            },
        )
    }

    if (confirmRestore) {
        AlertDialog(
            onDismissRequest = { confirmRestore = false },
            title = { Text(stringResource(R.string.restore_title)) },
            text = { Text(stringResource(R.string.restore_text)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmRestore = false
                    scope.launch {
                        repository.restoreBundled()
                        repository.dictionary.value?.let { now -> history.retainOnly(now.categories.map { it.id }.toSet()) }
                        snackbar.showSnackbar(resources.getString(R.string.restore_done))
                    }
                }) { Text(stringResource(R.string.restore_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmRestore = false }) { Text(stringResource(R.string.edit_cancel)) }
            },
        )
    }
}

@Composable
private fun EditorRow(category: Category, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(category.en, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        Text(category.jp, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (category.aliases.isNotEmpty()) {
            Text(
                stringResource(R.string.editor_aliases, category.aliases.joinToString(", ")),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun EmptyText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(16.dp),
    )
}

@Composable
private fun CategoryEditDialog(
    initial: Category?,
    existing: List<Category>,
    onDismiss: () -> Unit,
    onSave: (Category) -> Unit,
    onDelete: (Category) -> Unit,
) {
    var en by rememberSaveable { mutableStateOf(initial?.en.orEmpty()) }
    var jp by rememberSaveable { mutableStateOf(initial?.jp.orEmpty()) }
    var aliases by rememberSaveable { mutableStateOf(initial?.aliases?.joinToString(", ").orEmpty()) }

    val valid = en.isNotBlank() && jp.isNotBlank()
    val duplicate = remember(en, existing) {
        val name = CategorySearch.normalize(en)
        name.isNotEmpty() && existing.any { it.id != initial?.id && CategorySearch.normalize(it.en) == name }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (initial == null) R.string.edit_new_title else R.string.edit_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = en,
                    onValueChange = { en = it },
                    label = { Text(stringResource(R.string.edit_en)) },
                    supportingText = if (duplicate) {
                        { Text(stringResource(R.string.edit_duplicate)) }
                    } else {
                        null
                    },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = jp,
                    onValueChange = { jp = it },
                    label = { Text(stringResource(R.string.edit_jp)) },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = aliases,
                    onValueChange = { aliases = it },
                    label = { Text(stringResource(R.string.edit_aliases)) },
                )
                initial?.let {
                    Text(
                        stringResource(R.string.edit_id, it.id),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    it.gameId?.let { gameId ->
                        Text(
                            stringResource(R.string.edit_game_id, gameId),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = valid,
                onClick = {
                    // The id never changes: recents and favourites point to it. The game id stays too.
                    val id = initial?.id ?: DictionaryFormat.uniqueId(en, existing.map { it.id }.toSet())
                    DictionaryFormat.sanitize(Category(id, en, jp, aliases.split(','), initial?.gameId))?.let(onSave)
                },
            ) { Text(stringResource(R.string.edit_save)) }
        },
        dismissButton = {
            Row {
                if (initial != null) {
                    TextButton(
                        onClick = { onDelete(initial) },
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text(stringResource(R.string.edit_delete)) }
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.edit_cancel)) }
            }
        },
    )
}

@Composable
private fun ImportDialog(
    parsed: DictionaryFormat.ParseResult,
    currentCount: Int,
    onDismiss: () -> Unit,
    onImport: (merge: Boolean) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.import_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.import_summary, parsed.dictionary.categories.size, currentCount))
                if (parsed.dropped > 0) {
                    Text(stringResource(R.string.import_dropped, parsed.dropped), color = MaterialTheme.colorScheme.error)
                }
                Text(stringResource(R.string.import_explain), style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = { onImport(true) }) { Text(stringResource(R.string.import_merge)) }
                TextButton(onClick = { onImport(false) }) { Text(stringResource(R.string.import_replace)) }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.edit_cancel)) }
        },
    )
}

private suspend fun readText(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
    context.contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() }
        ?: error("file not readable")
}

private suspend fun writeText(context: Context, uri: Uri, text: String) = withContext(Dispatchers.IO) {
    context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.encodeToByteArray()) }
        ?: error("file not writable")
}
