package it.emanuelemelini.dokkants.categoryhelper.appupdate

import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Where the APK may come from, and the download itself against a local server. */
class ApkDownloadTest {

    private val start = "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/category-helper-v1.2.0/dokkants-category-helper.apk"

    @Test
    fun `the download starts only under this repository's release downloads, over https`() {
        assertTrue(ApkUrls.allowedStart(start))
        assertTrue(ApkUrls.allowedStart(start.replace("https://github.com", "https://GitHub.com")))
        assertTrue(ApkUrls.allowedStart(start.replace("github.com/", "github.com:443/")))
        for (url in listOf(
            start.replace("https://", "http://"),
            start.replace("EmanueleMelini/dokkan-team-sharing", "someone/else"),
            start.replace("github.com", "github.com.evil.example"),
            start.replace("https://", "https://user@"),
            start.replace("github.com/", "github.com:8443/"),
            "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/",
            "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/download/../../../other/repo/releases/download/x/a.apk",
            "https://github.com/EmanueleMelini/dokkan-team-sharing/releases/latest",
            "https://release-assets.githubusercontent.com/github-production-release-asset/1/2",
            "file:///sdcard/dokkants-category-helper.apk",
            "not a url",
        )) {
            assertFalse(url, ApkUrls.allowedStart(url))
        }
    }

    @Test
    fun `a redirect may lead to GitHub's asset host, over https only`() {
        assertTrue(ApkUrls.allowedRedirect("https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sp=r"))
        assertTrue(ApkUrls.allowedRedirect("https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2"))
        assertTrue(ApkUrls.allowedRedirect(start))
        assertFalse(ApkUrls.allowedRedirect("http://release-assets.githubusercontent.com/x"))
        assertFalse(ApkUrls.allowedRedirect("https://githubusercontent.com/x"))
        assertFalse(ApkUrls.allowedRedirect("https://githubusercontent.com.evil.example/x"))
        assertFalse(ApkUrls.allowedRedirect("https://evil.example/release-assets.githubusercontent.com/x"))
        assertFalse(ApkUrls.allowedRedirect("https://github.com/someone/else/releases/download/x/a.apk"))
    }

    // The download, against a local server: the policy allows its http URLs

    private object Loopback : ApkUrlPolicy {
        override fun allowedStart(url: String) = url.startsWith("http://127.0.0.1:") && url.contains("/download/")
        override fun allowedRedirect(url: String) = url.startsWith("http://127.0.0.1:") && !url.contains("/evil")
    }

    private val apk = ByteArray(200_000) { (it % 251).toByte() }

    private fun download(url: String, size: Long = apk.size.toLong(), progress: MutableList<Float> = mutableListOf()): ByteArray {
        val out = ByteArrayOutputStream()
        val written = runBlocking {
            ApkDownload.download(url, "DokkanTSCategoryHelper/1.2.0 (Android)", size, out, { progress += it }, Loopback)
        }
        assertEquals(written, out.size().toLong())
        return out.toByteArray()
    }

    private fun assertFails(block: () -> Unit) {
        try {
            block()
            fail("expected an IOException")
        } catch (_: IOException) {
        }
    }

    @Test
    fun `the APK is streamed whole, with the progress, after GitHub's redirect`() {
        LoopbackServer { request, out ->
            when (request.path) {
                "/download/v1/app.apk" -> LoopbackServer.respond(out, "302 Found", headers = mapOf("Location" to "/assets/app.apk?sig=1"))
                "/assets/app.apk?sig=1" -> LoopbackServer.respond(out, "200 OK", apk)
                else -> LoopbackServer.respond(out, "404 Not Found")
            }
        }.use { server ->
            val progress = mutableListOf<Float>()
            assertArrayEquals(apk, download("${server.base}/download/v1/app.apk", progress = progress))
            assertEquals(0f, progress.first())
            assertEquals(1f, progress.last())
            assertEquals(progress.sorted(), progress)
            assertEquals(listOf("/download/v1/app.apk", "/assets/app.apk?sig=1"), server.requests.map { it.path })
            assertEquals("DokkanTSCategoryHelper/1.2.0 (Android)", server.requests.last().header("User-Agent"))
        }
    }

    @Test
    fun `a URL or a redirect outside the policy is refused before anything is written`() {
        LoopbackServer { _, out ->
            LoopbackServer.respond(out, "302 Found", headers = mapOf("Location" to "/evil/app.apk"))
        }.use { server ->
            assertFails { download("${server.base}/elsewhere/app.apk") }
            assertTrue(server.requests.isEmpty())
            assertFails { download("${server.base}/download/app.apk") }
            assertEquals(1, server.requests.size)
        }
    }

    @Test
    fun `too many redirects stop`() {
        LoopbackServer { request, out ->
            LoopbackServer.respond(out, "302 Found", headers = mapOf("Location" to "/download/${request.path.length}"))
        }.use { server ->
            assertFails { download("${server.base}/download/a") }
            assertEquals(ApkDownload.MAX_REDIRECTS + 1, server.requests.size)
        }
    }

    @Test
    fun `the size must be the one GitHub reported`() {
        LoopbackServer { _, out -> LoopbackServer.respond(out, "200 OK", apk) }.use { server ->
            // Announced by Content-Length
            assertFails { download("${server.base}/download/a", size = apk.size + 1L) }
            assertFails { download("${server.base}/download/a", size = apk.size - 1L) }
        }
        // Without Content-Length: counted while reading
        LoopbackServer { _, out -> LoopbackServer.respond(out, "200 OK", apk, contentLength = null) }.use { server ->
            assertFails { download("${server.base}/download/a", size = apk.size - 1L) }
            assertFails { download("${server.base}/download/a", size = apk.size + 1L) }
            assertArrayEquals(apk, download("${server.base}/download/a"))
        }
    }

    @Test
    fun `an expected size of zero or over the cap is refused`() {
        assertFails { download("http://127.0.0.1:1/download/a", size = 0) }
        assertFails { download("http://127.0.0.1:1/download/a", size = ApkUrls.MAX_APK_BYTES + 1) }
    }

    @Test
    fun `an HTTP error stops the download`() {
        LoopbackServer { _, out -> LoopbackServer.respond(out, "404 Not Found") }.use { server ->
            assertFails { download("${server.base}/download/a") }
        }
    }
}
