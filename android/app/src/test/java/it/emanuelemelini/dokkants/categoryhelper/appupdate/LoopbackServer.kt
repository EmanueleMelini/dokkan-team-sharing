package it.emanuelemelini.dokkants.categoryhelper.appupdate

import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import kotlin.concurrent.thread

/**
 * A small HTTP/1.1 server on the loopback address for the unit tests: one connection at a time,
 * each answered by [handle] with the request line and headers it got, then closed.
 */
class LoopbackServer(private val handle: (Request, OutputStream) -> Unit) : AutoCloseable {

    data class Request(val line: String, val headers: List<String>) {
        val path: String get() = line.split(' ').getOrElse(1) { "" }

        fun header(name: String): String? = headers
            .firstOrNull { it.substringBefore(':').trim().equals(name, ignoreCase = true) }
            ?.substringAfter(':')?.trim()
    }

    private val socket = ServerSocket(0, 8, InetAddress.getLoopbackAddress())
    val base = "http://127.0.0.1:${socket.localPort}"

    /** Every request served, in order. */
    val requests: MutableList<Request> = Collections.synchronizedList(mutableListOf())

    private val worker = thread(isDaemon = true) {
        while (!socket.isClosed) {
            try {
                socket.accept().use { client ->
                    val reader = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                    val head = generateSequence { reader.readLine() }.takeWhile { it.isNotEmpty() }.toList()
                    if (head.isEmpty()) return@use
                    val request = Request(head.first(), head.drop(1))
                    requests += request
                    handle(request, client.getOutputStream())
                }
            } catch (_: IOException) {
                // Closed, or the client went away
            }
        }
    }

    override fun close() {
        socket.close()
        worker.join(5_000)
    }

    companion object {
        fun respond(
            out: OutputStream,
            status: String,
            body: ByteArray = ByteArray(0),
            headers: Map<String, String> = emptyMap(),
            contentLength: Long? = body.size.toLong(),
        ) {
            val head = buildString {
                append("HTTP/1.1 ").append(status).append("\r\n")
                headers.forEach { (name, value) -> append(name).append(": ").append(value).append("\r\n") }
                if (contentLength != null) append("Content-Length: ").append(contentLength).append("\r\n")
                append("Connection: close\r\n\r\n")
            }
            out.write(head.toByteArray(Charsets.ISO_8859_1))
            out.write(body)
            out.flush()
        }
    }
}
