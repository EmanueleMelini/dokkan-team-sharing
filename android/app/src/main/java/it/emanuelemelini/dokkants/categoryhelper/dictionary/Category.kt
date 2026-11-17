package it.emanuelemelini.dokkants.categoryhelper.dictionary

import kotlinx.serialization.Serializable

/**
 * One category: English name (official or community translation), Japanese name, search aliases.
 * Every field has a default so a hand-written file with a missing field still decodes;
 * [DictionaryFormat] then drops entries without names and generates missing ids.
 *
 * [gameId] is the category id in the game data (the bundled dictionary and the update check
 * set it); null for categories added by hand. It is how "Check for updates" recognises a
 * category the dictionary already has. [id] stays the key of recents and favourites.
 */
@Serializable
data class Category(
    val id: String = "",
    val en: String = "",
    val jp: String = "",
    val aliases: List<String> = emptyList(),
    val gameId: Int? = null,
)

/** The `categories.json` file. [version] lets a newer bundled dictionary replace an unedited stored copy. */
@Serializable
data class CategoryDictionary(
    val version: Int = 1,
    val categories: List<Category> = emptyList(),
)
