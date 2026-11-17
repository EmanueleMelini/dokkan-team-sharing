package it.emanuelemelini.dokkants.categoryhelper.update

import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The HTTP side of "Update categories" ([UpdateCheck.fetch]) against a one-request server on the
 * loopback address: the request it sends and how each kind of answer maps to a result.
 */
class UpdateCheckTest {

    /** Answers one request with [respond]; [requestHead] is the request line and headers it got. */
    private class OneShotServer(private val respond: (OutputStream) -> Unit) : AutoCloseable {
        private val socket = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val url = "http://127.0.0.1:${socket.localPort}/api/v1/categories"

        @Volatile
        var requestHead: List<String> = emptyList()

        private val worker = thread(isDaemon = true) {
            runCatching {
                socket.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                    requestHead = generateSequence { reader.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                    respond(client.getOutputStream())
                }
            }
        }

        override fun close() {
            socket.close()
            worker.join(5_000)
        }
    }

    private fun answer(status: String, body: ByteArray): (OutputStream) -> Unit = { out ->
        val head = "HTTP/1.1 $status\r\nContent-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.ISO_8859_1))
        out.write(body)
        out.flush()
    }

    private fun answer(status: String, body: String) = answer(status, body.toByteArray(Charsets.UTF_8))

    private fun fetch(server: OneShotServer) = runBlocking { UpdateCheck.fetch(server.url, UpdateCheck.userAgent("test")) }

    private fun failure(fetched: UpdateCheck.Fetched): UpdateResult.Failed {
        assertTrue("expected a failure, got $fetched", fetched is UpdateCheck.Fetched.Failure)
        return (fetched as UpdateCheck.Fetched.Failure).result
    }

    private val payload = """{"version":1,"categories":[{"id":1,"name_en":"Fusion","name_ja":"フュージョン","aliases":[]},""" +
        """{"id":100,"name_en":"Brand New Category","name_ja":"新しいカテゴリ","aliases":["bnc"]}]}"""

    @Test
    fun `a 200 with the contract gives the payload, and the request is a plain GET`() {
        OneShotServer(answer("200 OK", payload)).use { server ->
            val fetched = fetch(server)
            assertTrue("$fetched", fetched is UpdateCheck.Fetched.Ok)
            assertEquals(listOf(1, 100), (fetched as UpdateCheck.Fetched.Ok).payload.categories.map { it.gameId })
            assertEquals("新しいカテゴリ", fetched.payload.categories[1].jp)
            val head = server.requestHead
            assertEquals("GET /api/v1/categories HTTP/1.1", head.first())
            assertTrue("$head", head.any { it.equals("User-Agent: DokkanTSCategoryHelper/test (Android)", ignoreCase = true) })
            assertTrue("$head", head.any { it.equals("Accept: application/json", ignoreCase = true) })
            // Nothing that identifies the phone or the user
            assertTrue("$head", head.none { it.startsWith("Cookie", ignoreCase = true) || it.startsWith("Authorization", ignoreCase = true) })
        }
    }

    @Test
    fun `the User-Agent names the app and its version only`() {
        // Must not match the deny pattern of the site's firewall (root README, "Il firewall")
        assertEquals("DokkanTSCategoryHelper/1.0.0 (Android)", UpdateCheck.userAgent("1.0.0"))
    }

    @Test
    fun `another status is an HTTP failure with its code`() {
        OneShotServer(answer("404 Not Found", "nope")).use { server ->
            assertEquals(UpdateResult.Failed(UpdateResult.Reason.HTTP, 404), failure(fetch(server)))
        }
        OneShotServer(answer("503 Service Unavailable", "")).use { server ->
            assertEquals(UpdateResult.Failed(UpdateResult.Reason.HTTP, 503), failure(fetch(server)))
        }
    }

    @Test
    fun `a body that is not the contract is invalid`() {
        OneShotServer(answer("200 OK", "<html>maintenance</html>")).use { server ->
            assertEquals(UpdateResult.Reason.INVALID, failure(fetch(server)).reason)
        }
        OneShotServer(answer("200 OK", """{"version":1,"categories":[]}""")).use { server ->
            assertEquals(UpdateResult.Reason.INVALID, failure(fetch(server)).reason)
        }
    }

    @Test
    fun `a newer payload version asks for a newer app`() {
        OneShotServer(answer("200 OK", payload.replace("\"version\":1", "\"version\":2"))).use { server ->
            assertEquals(UpdateResult.Reason.NEWER_FORMAT, failure(fetch(server)).reason)
        }
    }

    @Test
    fun `a body over the cap is invalid`() {
        val huge = ByteArray(UpdateCheck.MAX_BYTES + 1) { ' '.code.toByte() }
        OneShotServer(answer("200 OK", huge)).use { server ->
            assertEquals(UpdateResult.Reason.INVALID, failure(fetch(server)).reason)
        }
    }

    @Test
    fun `no server is a network failure`() {
        val closed = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
        val port = closed.localPort
        closed.close()
        val fetched = runBlocking { UpdateCheck.fetch("http://127.0.0.1:$port/api/v1/categories", "test") }
        assertEquals(UpdateResult.Failed(UpdateResult.Reason.NETWORK), failure(fetched))
    }
}
