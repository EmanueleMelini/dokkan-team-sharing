package it.emanuelemelini.dokkants.categoryhelper.overlay

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import it.emanuelemelini.dokkants.categoryhelper.R
import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.search.CategorySearch
import java.util.Locale
import kotlinx.coroutines.flow.first

/**
 * The search card: field on top, then the results for the query, or favourites, recents and the
 * whole dictionary when the field is empty. Rows show the English and the Japanese name.
 *
 * @param categories null while the dictionary is loading.
 * @param appUpdateVersion a new version of the app, shown in a row at the top; null for none.
 */
@Composable
internal fun SearchPanelContent(
    categories: List<Category>?,
    favoriteIds: Set<String>,
    recentIds: List<String>,
    onSelect: (Category) -> Unit,
    onToggleFavorite: (Category) -> Unit,
    onClose: () -> Unit,
    appUpdateVersion: String? = null,
    onOpenAppUpdate: () -> Unit = {},
) {
    var query by remember { mutableStateOf("") }
    val all = categories.orEmpty()
    val results = remember(query, all) { CategorySearch.search(query, all) }
    val alphabetical = remember(all) { all.sortedBy { it.en.lowercase(Locale.ROOT) } }
    val favorites = remember(favoriteIds, alphabetical) { alphabetical.filter { it.id in favoriteIds } }
    val recents = remember(recentIds, all) {
        val byId = all.associateBy { it.id }
        recentIds.mapNotNull { byId[it] }
    }

    // The window gets focus a moment after it is added: only then can the field take the keyboard
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val windowInfo = LocalWindowInfo.current
    LaunchedEffect(Unit) {
        snapshotFlow { windowInfo.isWindowFocused }.first { it }
        focusRequester.requestFocus()
        keyboard?.show()
    }

    // Upper part of the screen, so the keyboard doesn't cover it even where insets aren't reported
    val maxCardHeight = with(LocalDensity.current) { (windowInfo.containerSize.height * 0.55f).toDp() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = 16.dp, vertical = 24.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        Card(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .fillMaxWidth()
                .heightIn(max = maxCardHeight)
                // Taps on the card itself must not reach the scrim (which closes the panel)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
            elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
        ) {
            Column {
                if (appUpdateVersion != null) {
                    AppUpdateRow(appUpdateVersion, onOpenAppUpdate)
                }
                SearchField(
                    query = query,
                    onQueryChange = { query = it },
                    focusRequester = focusRequester,
                    onSubmit = { results.firstOrNull()?.let(onSelect) },
                    onClose = onClose,
                )
                HorizontalDivider()
                LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f, fill = false)) {
                    when {
                        categories == null -> message(R.string.panel_loading)
                        query.isNotBlank() -> {
                            if (results.isEmpty()) {
                                item(key = "no-results") { Message(stringResource(R.string.panel_no_results, query.trim())) }
                            }
                            categoryRows("result", results, favoriteIds, onSelect, onToggleFavorite)
                        }
                        all.isEmpty() -> message(R.string.panel_empty_dictionary)
                        else -> {
                            if (favorites.isNotEmpty()) {
                                header("favorites", R.string.panel_favorites)
                                categoryRows("favorite", favorites, favoriteIds, onSelect, onToggleFavorite)
                            }
                            if (recents.isNotEmpty()) {
                                header("recents", R.string.panel_recents)
                                categoryRows("recent", recents, favoriteIds, onSelect, onToggleFavorite)
                            }
                            header("all", R.string.panel_all, all.size)
                            categoryRows("all", alphabetical, favoriteIds, onSelect, onToggleFavorite)
                        }
                    }
                }
            }
        }
    }
}

/** "Version X.Y.Z available": opens the app with the update dialog. */
@Composable
private fun AppUpdateRow(version: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.primaryContainer)
            .clickable(onClick = onClick)
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = stringResource(R.string.panel_app_update, version),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}

@Composable
private fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    focusRequester: FocusRequester,
    onSubmit: () -> Unit,
    onClose: () -> Unit,
) {
    Row(
        modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .weight(1f)
                .focusRequester(focusRequester),
            placeholder = { Text(stringResource(R.string.panel_search_hint)) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = if (query.isNotEmpty()) {
                {
                    IconButton(onClick = { onQueryChange("") }) {
                        Icon(Icons.Filled.Clear, contentDescription = stringResource(R.string.panel_clear))
                    }
                }
            } else {
                null
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Search,
            ),
            keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
        )
        IconButton(onClick = onClose) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.panel_close))
        }
    }
}

private fun LazyListScope.header(key: String, title: Int, count: Int? = null) {
    item(key = "header-$key") {
        val text = if (count != null) stringResource(R.string.panel_section_count, stringResource(title), count) else stringResource(title)
        Text(
            text = text,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp),
        )
    }
}

private fun LazyListScope.message(text: Int) {
    item(key = "message-$text") { Message(stringResource(text)) }
}

@Composable
private fun Message(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(16.dp),
    )
}

/** [section] keeps item keys unique when a category is both a favourite and a recent. */
private fun LazyListScope.categoryRows(
    section: String,
    categories: List<Category>,
    favoriteIds: Set<String>,
    onSelect: (Category) -> Unit,
    onToggleFavorite: (Category) -> Unit,
) {
    items(categories, key = { "$section-${it.id}" }) { category ->
        CategoryRow(category, category.id in favoriteIds, onSelect, onToggleFavorite)
    }
}

@Composable
private fun CategoryRow(
    category: Category,
    favorite: Boolean,
    onSelect: (Category) -> Unit,
    onToggleFavorite: (Category) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onSelect(category) }
            .padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = category.en,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = category.jp,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = { onToggleFavorite(category) }) {
            Icon(
                imageVector = if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                contentDescription = stringResource(
                    if (favorite) R.string.panel_unfavorite else R.string.panel_favorite,
                ),
                tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
