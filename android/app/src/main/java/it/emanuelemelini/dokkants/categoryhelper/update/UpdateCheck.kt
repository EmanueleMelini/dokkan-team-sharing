package it.emanuelemelini.dokkants.categoryhelper.update

import android.content.Context
import it.emanuelemelini.dokkants.categoryhelper.AppInfo
import it.emanuelemelini.dokkants.categoryhelper.diagnostics.DebugLog
import it.emanuelemelini.dokkants.categoryhelper.dictionary.Category
import it.emanuelemelini.dokkants.categoryhelper.dictionary.DictionaryRepository
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** What a manual "Check for updates" did. */
sealed interface UpdateResult {
    data class Added(val categories: List<Category>) : UpdateResult
    data object UpToDate : UpdateResult
    data class Failed(val reason: Reason, val httpCode: Int = 0) : UpdateResult

    enum class Reason {
        /** No connection, DNS failure, timeout. */
        NETWORK,

        /** The server answered with a status other than 200 ([Failed.httpCode]). */
        HTTP,

        /** Not the expected JSON. */
        INVALID,

        /** The server speaks a newer payload version: update the app. */
        NEWER_FORMAT,

        /** The new categories could not be saved on the phone (storage full, for example). */
        STORAGE,
    }
}

/**
 * The only network access of the app, and only when the user taps "Check for updates": one GET of
 * [CategoryUpdates.URL], then the new categories are appended ([DictionaryRepository.addNew]).
 * Nothing runs in the background, nothing is sent besides the request itself.
 */
object UpdateCheck {

    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    /** The payload is about 8 KB; anything far bigger is not the API. */
    internal const val MAX_BYTES = 1 shl 20

    /** What [fetch] got: the payload, or why the check failed (with a line for the log). */
    internal sealed interface Fetched {
        data class Ok(val payload: CategoryUpdates.Payload) : Fetched
        data class Failure(val result: UpdateResult.Failed, val log: String, val error: Throwable? = null) : Fetched
    }

    private class HttpStatusException(val code: Int) : Exception("HTTP $code")

    suspend fun run(context: Context): UpdateResult {
        val repository = DictionaryRepository.get(context)
        val payload = when (val fetched = fetch(CategoryUpdates.URL, userAgent(AppInfo.versionName(context)))) {
            is Fetched.Ok -> fetched.payload
            is Fetched.Failure -> {
                DebugLog.w("update check: ${fetched.log}", fetched.error)
                return fetched.result
            }
        }

        val added = try {
            repository.addNew { local, removed -> CategoryUpdates.newCategories(local, payload.categories, removed) }
        } catch (e: IOException) {
            DebugLog.w("update check: could not save the dictionary", e)
            return UpdateResult.Failed(UpdateResult.Reason.STORAGE)
        }
        DebugLog.d {
            "update check: ${payload.categories.size} remote (${payload.skipped} skipped), " +
                "added ${added.size}: ${added.joinToString { "${it.gameId} ${it.id}" }}"
        }
        return if (added.isEmpty()) UpdateResult.UpToDate else UpdateResult.Added(added)
    }

    /** The User-Agent of the request: the app and its version, nothing about the phone or the user. */
    internal fun userAgent(versionName: String) = "DokkanTSCategoryHelper/$versionName (Android)"

    /** The download and the parse, without Android (unit tested against a local server). */
    internal suspend fun fetch(url: String, userAgent: String): Fetched {
        val text = try {
            download(url, userAgent)
        } catch (e: HttpStatusException) {
            return Fetched.Failure(UpdateResult.Failed(UpdateResult.Reason.HTTP, e.code), "HTTP ${e.code}")
        } catch (e: IOException) {
            return Fetched.Failure(UpdateResult.Failed(UpdateResult.Reason.NETWORK), "network error", e)
        } catch (e: IllegalArgumentException) {
            return Fetched.Failure(UpdateResult.Failed(UpdateResult.Reason.INVALID), "bad response", e)
        }

        return try {
            Fetched.Ok(CategoryUpdates.parse(text))
        } catch (e: CategoryUpdates.NewerFormatException) {
            Fetched.Failure(UpdateResult.Failed(UpdateResult.Reason.NEWER_FORMAT), "payload version ${e.version}")
        } catch (e: IllegalArgumentException) {
            // SerializationException is an IllegalArgumentException too
            Fetched.Failure(UpdateResult.Failed(UpdateResult.Reason.INVALID), "unexpected payload", e)
        }
    }

    /** Blocking HTTP on the IO dispatcher, bounded by the timeouts. */
    private suspend fun download(url: String, userAgent: String): String = withContext(Dispatchers.IO) {
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", userAgent)
            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_OK) throw HttpStatusException(code)
            connection.inputStream.use(::readLimited).decodeToString()
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
}
