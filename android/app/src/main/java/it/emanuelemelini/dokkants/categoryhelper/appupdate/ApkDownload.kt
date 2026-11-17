package it.emanuelemelini.dokkants.categoryhelper.appupdate

import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URISyntaxException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** Where the APK may come from. */
interface ApkUrlPolicy {
    /** The URL the download starts from. */
    fun allowedStart(url: String): Boolean

    /** Where a redirect may lead. */
    fun allowedRedirect(url: String): Boolean
}

/**
 * The production rule: the download starts only from an HTTPS URL under this repository's
 * release downloads, and a redirect may lead only there again or to GitHub's asset host
 * (release-assets.githubusercontent.com today, objects.githubusercontent.com before), HTTPS only.
 */
object ApkUrls : ApkUrlPolicy {

    const val DOWNLOAD_PREFIX = "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/"

    /** The APK is about 10 MB: a much bigger file is not ours. */
    const val MAX_APK_BYTES = 64L shl 20

    private const val GITHUB = "github.com"
    private const val PATH_PREFIX = "/EmanueleMelini/dokkan-team-sharing/releases/download/"
    private const val ASSET_HOST_SUFFIX = ".githubusercontent.com"

    override fun allowedStart(url: String): Boolean {
        val uri = httpsUri(url) ?: return false
        val path = uri.path ?: return false
        return uri.host.equals(GITHUB, ignoreCase = true) &&
            path.startsWith(PATH_PREFIX) &&
            path.length > PATH_PREFIX.length &&
            path.split('/').none { it == ".." || it == "." }
    }

    override fun allowedRedirect(url: String): Boolean {
        if (allowedStart(url)) return true
        val uri = httpsUri(url) ?: return false
        val host = uri.host.lowercase()
        return host.endsWith(ASSET_HOST_SUFFIX) && host.length > ASSET_HOST_SUFFIX.length
    }

    /** An absolute https URL on the default port, without user info; null otherwise. */
    private fun httpsUri(url: String): URI? {
        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return null
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        if (uri.host.isNullOrEmpty() || uri.rawUserInfo != null) return null
        if (uri.port != -1 && uri.port != 443) return null
        return uri
    }
}

/** Why a download stopped (always an IOException: the caller treats them alike). */
class ApkDownloadException(message: String) : IOException(message)

/**
 * The HTTP side of the in-app update: streams the APK into [output] (the PackageInstaller session),
 * following at most [MAX_REDIRECTS] redirects by hand, each one checked by the [policy]. The file
 * must be exactly [expectedSize] bytes, the size the GitHub API reported, and never more than
 * [ApkUrls.MAX_APK_BYTES]. Cancellable between two reads. Unit tested against a local server.
 */
object ApkDownload {

    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val BUFFER_SIZE = 64 * 1024
    internal const val MAX_REDIRECTS = 5

    /** Returns the bytes written; [onProgress] gets 0..1. */
    suspend fun download(
        url: String,
        userAgent: String,
        expectedSize: Long,
        output: OutputStream,
        onProgress: (Float) -> Unit,
        policy: ApkUrlPolicy = ApkUrls,
    ): Long = withContext(Dispatchers.IO) {
        if (expectedSize !in 1..ApkUrls.MAX_APK_BYTES) throw ApkDownloadException("unexpected size $expectedSize")
        if (!policy.allowedStart(url)) throw ApkDownloadException("not a release download: $url")
        var current = url
        // The first request, then one per redirect
        repeat(MAX_REDIRECTS + 1) {
            ensureActive()
            val connection = URI(current).toURL().openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.useCaches = false
                connection.setRequestProperty("Accept", "application/octet-stream")
                connection.setRequestProperty("User-Agent", userAgent)
                when (val code = connection.responseCode) {
                    HttpURLConnection.HTTP_OK -> return@withContext copy(connection, expectedSize, output, onProgress)
                    in REDIRECTS -> {
                        val location = connection.getHeaderField("Location")
                            ?: throw ApkDownloadException("redirect without a location")
                        val next = try {
                            URI(current).resolve(location.trim()).toString()
                        } catch (_: IllegalArgumentException) {
                            throw ApkDownloadException("bad redirect")
                        }
                        if (!policy.allowedRedirect(next)) throw ApkDownloadException("redirect refused: $next")
                        current = next
                    }
                    else -> throw ApkDownloadException("HTTP $code")
                }
            } finally {
                connection.disconnect()
            }
        }
        throw ApkDownloadException("too many redirects")
    }

    private suspend fun copy(
        connection: HttpURLConnection,
        expectedSize: Long,
        output: OutputStream,
        onProgress: (Float) -> Unit,
    ): Long = withContext(Dispatchers.IO) {
        val announced = connection.contentLengthLong
        if (announced >= 0 && announced != expectedSize) {
            throw ApkDownloadException("the server announced $announced bytes, the release $expectedSize")
        }
        var written = 0L
        onProgress(0f)
        connection.inputStream.use { input ->
            val buffer = ByteArray(BUFFER_SIZE)
            while (true) {
                ensureActive()
                val read = input.read(buffer)
                if (read < 0) break
                written += read
                if (written > expectedSize) throw ApkDownloadException("longer than $expectedSize bytes")
                output.write(buffer, 0, read)
                onProgress(written.toFloat() / expectedSize)
            }
        }
        if (written != expectedSize) throw ApkDownloadException("incomplete: $written of $expectedSize bytes")
        written
    }

    private val REDIRECTS = setOf(301, 302, 303, 307, 308)
}
