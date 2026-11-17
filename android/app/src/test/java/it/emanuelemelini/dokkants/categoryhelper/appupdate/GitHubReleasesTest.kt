package it.emanuelemelini.dokkants.categoryhelper.appupdate

import it.emanuelemelini.dokkants.categoryhelper.update.UpdateCheck
import java.net.InetAddress
import java.net.ServerSocket
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** GET /releases/latest: the parse (offline answers shaped like GitHub's) and the request (loopback server). */
class GitHubReleasesTest {

    private val apkUrl = "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/category-helper-v1.2.0/dokkants-category-helper.apk"
    private val notesBody = "DokkanTS Category Helper 1.2.0.\n\n- Updates from the app.\n\n<!-- dch-notes:it\n- Aggiornamenti dall'app.\n-->\n"

    private fun release(
        tag: String = "category-helper-v1.2.0",
        assetName: String = "dokkants-category-helper.apk",
        url: String = apkUrl,
        size: Long? = 9_400_000,
        state: String? = "uploaded",
        body: String? = notesBody,
        extra: Map<String, Boolean> = emptyMap(),
    ): String = buildJsonObject {
        put("tag_name", tag)
        put("html_url", "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/tag/$tag")
        put("draft", extra["draft"] ?: false)
        put("prerelease", extra["prerelease"] ?: false)
        if (body != null) put("body", body)
        put(
            "assets",
            buildJsonArray {
                add(buildJsonObject {
                    put("name", "notes.txt")
                    put("browser_download_url", "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/x/notes.txt")
                    put("size", 10)
                })
                add(buildJsonObject {
                    put("name", assetName)
                    put("browser_download_url", url)
                    if (size != null) put("size", size)
                    if (state != null) put("state", state)
                    put("content_type", "application/vnd.android.package-archive")
                })
            },
        )
    }.toString()

    @Test
    fun `a release of the app gives version, notes, APK and page`() {
        val parsed = requireNotNull(GitHubReleases.parse(release()))
        assertEquals(AppVersion.parse("1.2.0"), parsed.version)
        assertEquals(apkUrl, parsed.apkUrl)
        assertEquals(9_400_000L, parsed.apkSize)
        assertEquals("https://github.com/EmanueleMelini/dokkan-team-sharing/releases/tag/category-helper-v1.2.0", parsed.pageUrl)
        assertEquals(listOf("Updates from the app."), parsed.notes.forLanguage("en"))
        assertEquals(listOf("Aggiornamenti dall'app."), parsed.notes.forLanguage("it"))
    }

    @Test
    fun `only category-helper-vX_Y_Z tags count`() {
        for (tag in listOf("v1.2.0", "1.2.0", "category-helper-v1.2", "category-helper-v1.2.0-rc1", "site-2026-11-17", "category-helper-v1.2.0.1")) {
            assertNull(tag, GitHubReleases.parse(release(tag = tag)))
        }
    }

    @Test
    fun `only the asset with the exact name, under this repository's downloads, with a sane size`() {
        assertNull(GitHubReleases.parse(release(assetName = "DokkanTS-Category-Helper.apk")))
        assertNull(GitHubReleases.parse(release(assetName = "dokkants-category-helper.apk.sig")))
        assertNull(GitHubReleases.parse(release(url = apkUrl.replace("https://", "http://"))))
        assertNull(GitHubReleases.parse(release(url = apkUrl.replace("EmanueleMelini/dokkan-team-sharing", "someone/else"))))
        assertNull(GitHubReleases.parse(release(url = "https://example.com/dokkants-category-helper.apk")))
        assertNull(GitHubReleases.parse(release(size = null)))
        assertNull(GitHubReleases.parse(release(size = 0)))
        assertNull(GitHubReleases.parse(release(size = ApkUrls.MAX_APK_BYTES + 1)))
        assertNull(GitHubReleases.parse(release(state = "starter")))
        // An answer without "state" (older API answers) is fine
        assertEquals(apkUrl, GitHubReleases.parse(release(state = null))?.apkUrl)
    }

    @Test
    fun `drafts and prereleases are ignored`() {
        assertNull(GitHubReleases.parse(release(extra = mapOf("draft" to true))))
        assertNull(GitHubReleases.parse(release(extra = mapOf("prerelease" to true))))
    }

    @Test
    fun `a missing body means no notes, a page outside the repository falls back to the releases page`() {
        val noBody = requireNotNull(GitHubReleases.parse(release(body = null)))
        assertTrue(noBody.notes.isEmpty)
        val json = Json.parseToJsonElement(release()) as JsonObject
        val otherPage = JsonObject(json + ("html_url" to JsonPrimitive("https://evil.example/releases/1")))
        assertEquals(GitHubReleases.RELEASES_PAGE, GitHubReleases.parse(otherPage.toString())?.pageUrl)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `an answer that is not JSON is an error`() {
        GitHubReleases.parse("<html>rate limited</html>")
    }

    // The request, against a local server

    private fun fetch(server: LoopbackServer) =
        runBlocking { GitHubReleases.fetchLatest("${server.base}/repos/x/releases/latest", UpdateCheck.userAgent("1.2.0")) }

    @Test
    fun `a 200 is the release, and the request has the GitHub headers and the app's User-Agent`() {
        LoopbackServer { _, out -> LoopbackServer.respond(out, "200 OK", release().toByteArray()) }.use { server ->
            val result = fetch(server)
            assertTrue("$result", result is LatestRelease.Found)
            assertEquals(AppVersion.parse("1.2.0"), (result as LatestRelease.Found).release.version)
            val request = server.requests.single()
            assertEquals("GET /repos/x/releases/latest HTTP/1.1", request.line)
            assertEquals("application/vnd.github+json", request.header("Accept"))
            assertEquals("2022-11-28", request.header("X-GitHub-Api-Version"))
            assertEquals("DokkanTSCategoryHelper/1.2.0 (Android)", request.header("User-Agent"))
            // No token, nothing about the phone or the user
            assertNull(request.header("Authorization"))
            assertNull(request.header("Cookie"))
        }
    }

    @Test
    fun `a 404 means no release yet, another status is an HTTP failure`() {
        LoopbackServer { _, out -> LoopbackServer.respond(out, "404 Not Found", "{}".toByteArray()) }.use {
            assertEquals(LatestRelease.NoRelease, fetch(it))
        }
        LoopbackServer { _, out -> LoopbackServer.respond(out, "403 Forbidden", "rate limit".toByteArray()) }.use {
            assertEquals(LatestRelease.Failed(LatestRelease.Reason.HTTP, 403), fetch(it))
        }
        LoopbackServer { _, out -> LoopbackServer.respond(out, "503 Service Unavailable") }.use {
            assertEquals(LatestRelease.Failed(LatestRelease.Reason.HTTP, 503), fetch(it))
        }
    }

    @Test
    fun `a 200 that is not a release of the app is no release, one that is not JSON is invalid`() {
        LoopbackServer { _, out -> LoopbackServer.respond(out, "200 OK", release(tag = "v9.9.9").toByteArray()) }.use {
            assertEquals(LatestRelease.NoRelease, fetch(it))
        }
        LoopbackServer { _, out -> LoopbackServer.respond(out, "200 OK", "<html>".toByteArray()) }.use {
            assertEquals(LatestRelease.Failed(LatestRelease.Reason.INVALID), fetch(it))
        }
    }

    @Test
    fun `a body over the cap is invalid`() {
        val huge = ByteArray(GitHubReleases.MAX_BYTES + 1) { ' '.code.toByte() }
        LoopbackServer { _, out -> LoopbackServer.respond(out, "200 OK", huge) }.use {
            assertEquals(LatestRelease.Failed(LatestRelease.Reason.INVALID), fetch(it))
        }
    }

    @Test
    fun `no server is a network failure`() {
        val closed = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val port = closed.localPort
        closed.close()
        val result = runBlocking { GitHubReleases.fetchLatest("http://127.0.0.1:$port/latest", "test") }
        assertEquals(LatestRelease.Failed(LatestRelease.Reason.NETWORK), result)
    }

    @Test
    fun `the production URLs`() {
        assertEquals("https://api.github.com/repos/EmanueleMelini/dokkan-team-sharing/releases/latest", GitHubReleases.LATEST_URL)
        assertEquals(
            "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/latest/download/dokkants-category-helper.apk",
            GitHubReleases.BROWSER_DOWNLOAD_URL,
        )
    }
}
