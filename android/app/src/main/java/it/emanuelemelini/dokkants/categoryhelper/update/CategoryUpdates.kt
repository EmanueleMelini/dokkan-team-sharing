package it.emanuelemelini.dokkants.categoryhelper.update

import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryFormat
import it.emanuelemelini.dokkants.categoryhelper.search.CategorySearch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * "Check for updates": the category list of Dokkan Team Sharing and the rule that picks what to
 * add. Pure code (no Android, no network), unit tested offline.
 *
 * The payload of `GET /api/v1/categories`, version 1:
 * ```
 * {"version":1,"categories":[{"id":1,"name_en":"Fusion","name_ja":"フュージョン","aliases":["..."]}, ...]}
 * ```
 * `id` is the category id in the game, `name_ja` is null while the Japanese name is unknown.
 * Unknown fields are ignored; a higher `version` means a format this app does not know.
 */
object CategoryUpdates {

    const val URL = "https://dokkants.app/api/v1/categories"
    const val SUPPORTED_VERSION = 1

    /** A category of the payload; [jp] is null when the server has no Japanese name yet. */
    data class RemoteCategory(val gameId: Int, val en: String, val jp: String?, val aliases: List<String>)

    /** [skipped]: entries that were not valid categories, or repeated an id. */
    data class Payload(val version: Int, val categories: List<RemoteCategory>, val skipped: Int)

    /** The server speaks a newer format: the app must be updated. */
    class NewerFormatException(val version: Int) : IllegalArgumentException("payload version $version is newer than $SUPPORTED_VERSION")

    /**
     * Reads the payload; single bad entries are skipped and counted.
     * @throws NewerFormatException for a version above [SUPPORTED_VERSION].
     * @throws IllegalArgumentException (SerializationException included) if it is not the contract
     *   or has no valid category at all.
     */
    fun parse(text: String): Payload {
        val root = Json.parseToJsonElement(text) as? JsonObject
            ?: throw IllegalArgumentException("not a JSON object")
        val version = intOf(root["version"]) ?: throw IllegalArgumentException("no \"version\"")
        if (version > SUPPORTED_VERSION) throw NewerFormatException(version)
        require(version >= 1) { "bad version $version" }
        val elements = root["categories"] as? JsonArray ?: throw IllegalArgumentException("no \"categories\" array")

        val seen = mutableSetOf<Int>()
        val categories = mutableListOf<RemoteCategory>()
        var skipped = 0
        for (element in elements) {
            val category = remoteOf(element)
            if (category == null || !seen.add(category.gameId)) {
                skipped++
                continue
            }
            categories += category
        }
        require(categories.isNotEmpty()) { "no valid category" }
        return Payload(version, categories, skipped)
    }

    /**
     * The categories to add: remote ones with a Japanese name that the dictionary does not have
     * and the user did not remove ([removed]: game ids deleted, or left out of a "Replace" import).
     * A remote category is already there when a local entry has its game id or, among local
     * entries without a game id (added by hand or imported), one has the same English name or the
     * same Japanese name (normalized as in search). Local entries are never changed, even when one
     * matches by name. New entries get the game id and a slug of the English name that no entry
     * uses yet, so recents and favourites can point to them.
     */
    fun newCategories(local: List<Category>, remote: List<RemoteCategory>, removed: Set<Int> = emptySet()): List<Category> {
        val gameIds = local.mapNotNullTo(mutableSetOf()) { it.gameId }
        val handMade = local.filter { it.gameId == null }
        val englishNames = handMade.mapTo(mutableSetOf()) { CategorySearch.normalize(it.en) }.apply { remove("") }
        val japaneseNames = handMade.mapTo(mutableSetOf()) { CategorySearch.normalize(it.jp) }.apply { remove("") }
        val taken = local.mapTo(mutableSetOf()) { it.id }

        val added = mutableListOf<Category>()
        for (item in remote) {
            val jp = item.jp ?: continue
            if (item.gameId in gameIds || item.gameId in removed) continue
            if (CategorySearch.normalize(item.en) in englishNames || CategorySearch.normalize(jp) in japaneseNames) continue
            val id = DictionaryFormat.uniqueId(item.en, taken)
            val category = DictionaryFormat.sanitize(Category(id, item.en, jp, item.aliases, item.gameId)) ?: continue
            taken += category.id
            gameIds += item.gameId
            added += category
        }
        return added
    }

    private fun remoteOf(element: JsonElement): RemoteCategory? {
        val fields = element as? JsonObject ?: return null
        val gameId = intOf(fields["id"])?.takeIf { it > 0 } ?: return null
        val en = stringOf(fields["name_en"]) ?: return null
        val jp = stringOf(fields["name_ja"])
        val aliases = (fields["aliases"] as? JsonArray).orEmpty().mapNotNull(::stringOf)
        return RemoteCategory(gameId, en, jp, aliases)
    }

    /** A JSON number holding a whole number; strings do not count. */
    private fun intOf(element: JsonElement?): Int? =
        (element as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toIntOrNull()

    /** A non-blank JSON string, trimmed; null for null, numbers and blanks. */
    private fun stringOf(element: JsonElement?): String? =
        (element as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()?.ifEmpty { null }
}
