package it.emanuelemelini.dokkants.categoryhelper.appupdate

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/** A published release of the app on GitHub, with its signed APK. */
data class AppRelease(
    val version: AppVersion,
    val notes: ReleaseNotes,
    /** The asset's browser_download_url, under [ApkUrls.DOWNLOAD_PREFIX]. */
    val apkUrl: String,
    /** Bytes, as GitHub reports them: the download must be exactly this long. */
    val apkSize: Long,
    /** The release page on GitHub. */
    val pageUrl: String,
)

/** What the GitHub API said about the latest release. */
sealed interface LatestRelease {
    data class Found(val release: AppRelease) : LatestRelease

    /** No release yet (404), or the latest one is not a release of this app with its APK. */
    data object NoRelease : LatestRelease

    data class Failed(val reason: Reason, val httpCode: Int = 0) : LatestRelease

    enum class Reason {
        /** No connection, DNS failure, timeout. */
        NETWORK,

        /** A status other than 200 and 404 (a rate limit is 403 or 429). */
        HTTP,

        /** Not the JSON of a release. */
        INVALID,
    }
}

/**
 * The latest release of this repository from the public GitHub API, without a token (60 requests
 * per hour per IP address, far more than one check a day needs). The release workflow publishes
 * only `category-helper-vX.Y.Z` tags with the asset [ASSET_NAME], marked Latest.
 */
object GitHubReleases {

    const val LATEST_URL = "https://api.github.com/repos/EmanueleMelini/dokkan-team-sharing/releases/latest"

    /** The releases page, when a release has no page URL of its own. */
    const val RELEASES_PAGE = "https://github.com/EmanueleMelini/dokkan-team-sharing/releases"

    /** The APK of the latest release in the browser (the link of the site, and the fallback of every failure). */
    const val BROWSER_DOWNLOAD_URL = "$RELEASES_PAGE/latest/download/dokkants-category-helper.apk"

    const val ASSET_NAME = "dokkants-category-helper.apk"
    const val TAG_PREFIX = "category-helper-v"
    const val API_VERSION = "2022-11-28"

    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    /** A release is a few KB of JSON; anything far bigger is not the API. */
    internal const val MAX_BYTES = 1 shl 20

    private val TAG = Regex("""${Regex.escape(TAG_PREFIX)}(\d{1,6}\.\d{1,6}\.\d{1,6})""")

    private val json = Json { ignoreUnknownKeys = true }

    private class HttpStatusException(val code: Int) : Exception("HTTP $code")

    /** The GET and the parse (unit tested against a local server, with another [url]). */
    suspend fun fetchLatest(url: String, userAgent: String): LatestRelease {
        val (code, body) = try {
            download(url, userAgent)
        } catch (e: HttpStatusException) {
            return LatestRelease.Failed(LatestRelease.Reason.HTTP, e.code)
        } catch (_: IOException) {
            return LatestRelease.Failed(LatestRelease.Reason.NETWORK)
        } catch (_: IllegalArgumentException) {
            // Over the cap
            return LatestRelease.Failed(LatestRelease.Reason.INVALID)
        }
        // No release published yet
        if (code == HttpURLConnection.HTTP_NOT_FOUND) return LatestRelease.NoRelease
        return try {
            parse(body)?.let { LatestRelease.Found(it) } ?: LatestRelease.NoRelease
        } catch (_: IllegalArgumentException) {
            // SerializationException is an IllegalArgumentException too
            LatestRelease.Failed(LatestRelease.Reason.INVALID)
        }
    }

    /**
     * The body of GET /releases/latest. Null when it is not a release of this app: a tag that is not
     * `category-helper-vX.Y.Z`, a draft or prerelease, no asset named exactly [ASSET_NAME], an APK
     * URL outside this repository's releases ([ApkUrls.allowedStart]) or a size outside
     * 1..[ApkUrls.MAX_APK_BYTES]. Throws IllegalArgumentException when it is not JSON at all.
     */
    fun parse(body: String): AppRelease? {
        val root = json.parseToJsonElement(body) as? JsonObject
            ?: throw SerializationException("not a JSON object")
        val tag = root.string("tag_name") ?: return null
        val version = TAG.matchEntire(tag)?.groupValues?.get(1)?.let(AppVersion::parse) ?: return null
        if (root.boolean("draft") == true || root.boolean("prerelease") == true) return null
        val asset = (root["assets"] as? JsonArray).orEmpty()
            .mapNotNull { it as? JsonObject }
            .firstOrNull { it.string("name") == ASSET_NAME }
            ?: return null
        // "uploaded" once complete (absent in older answers)
        if (asset.string("state").let { it != null && it != "uploaded" }) return null
        val apkUrl = asset.string("browser_download_url")?.takeIf(ApkUrls::allowedStart) ?: return null
        val size = (asset["size"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return null
        if (size !in 1..ApkUrls.MAX_APK_BYTES) return null
        val page = root.string("html_url")?.takeIf { it.startsWith("$RELEASES_PAGE/") } ?: RELEASES_PAGE
        return AppRelease(
            version = version,
            notes = root.string("body")?.let(ReleaseNotes::parse) ?: ReleaseNotes.EMPTY,
            apkUrl = apkUrl,
            apkSize = size,
            pageUrl = page,
        )
    }

    /** Blocking HTTP on the IO dispatcher; the status (200 or 404) and the body. */
    private suspend fun download(url: String, userAgent: String): Pair<Int, String> = withContext(Dispatchers.IO) {
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            connection.setRequestProperty("X-GitHub-Api-Version", API_VERSION)
            // GitHub rejects requests without a User-Agent
            connection.setRequestProperty("User-Agent", userAgent)
            when (val code = connection.responseCode) {
                HttpURLConnection.HTTP_OK -> code to connection.inputStream.use(::readLimited).decodeToString()
                HttpURLConnection.HTTP_NOT_FOUND -> code to ""
                else -> throw HttpStatusException(code)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun readLimited(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
            require(out.size() <= MAX_BYTES) { "response larger than $MAX_BYTES bytes" }
        }
        return out.toByteArray()
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.boolean(key: String): Boolean? = (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
}
