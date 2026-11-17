package it.emanuelemelini.dokkants.categoryhelper.dictionary

import it.emanuelemelini.dokkants.categoryhelper.search.CategorySearch
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * Reading and writing `categories.json`, lenient with hand-written files: comments and trailing
 * commas are accepted, a bare array of categories works too, missing ids are generated from the
 * English name, entries without English or Japanese name are dropped (and counted). An optional
 * `gameId` that is not a positive whole number (or a string holding one) is ignored, the entry
 * is kept.
 */
object DictionaryFormat {

    data class ParseResult(val dictionary: CategoryDictionary, val dropped: Int)

    @OptIn(ExperimentalSerializationApi::class)
    private val reader = Json {
        ignoreUnknownKeys = true
        allowComments = true
        allowTrailingComma = true
    }

    @OptIn(ExperimentalSerializationApi::class)
    private val writer = Json {
        prettyPrint = true
        prettyPrintIndent = "  "
        encodeDefaults = true
        // No "gameId": null for the categories added by hand
        explicitNulls = false
    }

    /** @throws IllegalArgumentException if the text is not JSON or not a dictionary at all. */
    fun parse(text: String): ParseResult {
        val root = reader.parseToJsonElement(text)
        val (version, elements) = when (root) {
            is JsonArray -> 1 to root
            is JsonObject -> {
                val version = (root["version"] as? JsonPrimitive)?.intOrNull ?: 1
                val categories = root["categories"] as? JsonArray
                    ?: throw IllegalArgumentException("no \"categories\" array")
                version to categories
            }
            else -> throw IllegalArgumentException("not a dictionary")
        }

        val ids = mutableSetOf<String>()
        val categories = mutableListOf<Category>()
        var dropped = 0
        for (element in elements) {
            val clean = decodeCategory(element)?.let(::sanitize)
            if (clean == null) {
                dropped++
                continue
            }
            val id = when {
                clean.id.isEmpty() -> uniqueId(clean.en, ids)
                clean.id in ids -> {
                    dropped++
                    continue
                }
                else -> clean.id
            }
            ids += id
            categories += clean.copy(id = id)
        }
        return ParseResult(CategoryDictionary(version, categories), dropped)
    }

    /** One entry, or null if it is not an object of the right shape; a bad `gameId` is dropped alone. */
    private fun decodeCategory(element: JsonElement): Category? {
        val fields = element as? JsonObject ?: return null
        val gameId = gameIdOf(fields["gameId"])
        return runCatching { reader.decodeFromJsonElement(Category.serializer(), JsonObject(fields - "gameId")) }
            .getOrNull()
            ?.copy(gameId = gameId)
    }

    /** 12 or "12" → 12; anything else (null, 0, -3, 1.5, "x", an object) → null. */
    internal fun gameIdOf(element: JsonElement?): Int? {
        val primitive = element as? JsonPrimitive ?: return null
        return primitive.content.trim().toIntOrNull()?.takeIf { it > 0 }
    }

    fun encode(dictionary: CategoryDictionary): String =
        writer.encodeToString(CategoryDictionary.serializer(), dictionary) + "\n"

    /** Trimmed names and aliases, blank and duplicate aliases removed, gameId only if positive; null without both names. */
    fun sanitize(category: Category): Category? {
        val en = category.en.trim()
        val jp = category.jp.trim()
        if (en.isEmpty() || jp.isEmpty()) return null
        val aliases = category.aliases
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .distinctBy { CategorySearch.normalize(it) }
        return Category(category.id.trim(), en, jp, aliases, category.gameId?.takeIf { it > 0 })
    }

    /** Slug of the English name ("Goku's Family" → "gokus_family"), suffixed with _2, _3… if taken. */
    fun uniqueId(en: String, taken: Set<String>): String {
        val base = CategorySearch.normalize(en).replace(' ', '_').ifEmpty { "category" }
        if (base !in taken) return base
        var n = 2
        while ("${base}_$n" in taken) n++
        return "${base}_$n"
    }

    /**
     * Imported entries update the existing one with the same id, else the one with the same
     * game id, else the one with the same English name (keeping its id, so favourites and recents
     * survive, and its game id: a hand-made file cannot move an entry to another game id, and a
     * file exported before game ids existed has none); the others are added. An entry without a
     * game id takes the imported one only if no other entry has it.
     */
    fun merge(current: List<Category>, imported: List<Category>): List<Category> {
        val result = current.toMutableList()
        for (item in imported) {
            val name = CategorySearch.normalize(item.en)
            val index = result.indexOfFirst { it.id == item.id }
                .takeIf { it >= 0 }
                ?: item.gameId?.let { gameId -> result.indexOfFirst { it.gameId == gameId } }?.takeIf { it >= 0 }
                ?: result.indexOfFirst { CategorySearch.normalize(it.en) == name }
            if (index >= 0) {
                val old = result[index]
                val gameId = old.gameId ?: item.gameId?.takeIf { gameId -> result.none { it.gameId == gameId } }
                result[index] = item.copy(id = old.id, gameId = gameId)
            } else {
                result += item
            }
        }
        return result
    }
}
