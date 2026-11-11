package dev.orb.app.link

import dev.orb.app.link.api.OrbApi
import dev.orb.app.link.crypto.LinkCrypto
import dev.orb.app.link.net.Clock
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkClient
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.LinkSessionCodec
import dev.orb.app.link.net.PairError
import dev.orb.app.link.net.Pairing
import dev.orb.app.link.net.PairingException
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.parseLinkPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.zip.CRC32
import java.util.zip.Deflater

/**
 * The link client against the PC's REAL engine (no fake). Skipped unless `ORB_E2E_PC` names a JSON file written by
 * `test/android-native.e2e.mjs`: `{ link, password, base? }`. `base` replaces the QR's addresses when they
 * are not reachable from the test machine. Nothing secret is printed.
 */
class RealPcE2eTest {
    private class Config(val link: String, val password: String, val base: String?)

    private fun config(): Config {
        val path = System.getenv("ORB_E2E_PC")
        assumeTrue("ORB_E2E_PC is not set: no real PC to talk to", !path.isNullOrBlank())
        val o = Json.parseToJsonElement(File(path!!).readText()).jsonObject
        fun s(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return Config(s("link")!!, s("password")!!, s("base"))
    }

    private val http = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).build()

    private suspend fun resolve(cfg: Config, text: String): ResolvedLink {
        val link = Pairing(http).resolve(parseLinkPayload(text)).getOrThrow()
        // The QR may carry addresses only the phone can reach; the test talks to the engine on this machine.
        return if (cfg.base == null) link else ResolvedLink(listOf(cfg.base), link.code, link.pc, link.pcPub, link.fp, link.name, link.via)
    }

    private fun step(name: String) = println("E2E step ok: $name")

    private fun tinyPng(): ByteArray {
        fun chunk(out: DataOutputStream, type: String, data: ByteArray) {
            out.writeInt(data.size)
            val body = type.toByteArray(Charsets.US_ASCII) + data
            out.write(body)
            out.writeInt(CRC32().also { it.update(body) }.value.toInt())
        }
        val deflater = Deflater().also { it.setInput(byteArrayOf(0, 0x20, 0x40, 0x60)); it.finish() } // filter byte + one RGB pixel
        val z = ByteArray(64)
        val zn = deflater.deflate(z)
        val ihdr = ByteArrayOutputStream().also {
            DataOutputStream(it).apply { writeInt(1); writeInt(1); write(8); write(2); write(0); write(0); write(0) }
        }.toByteArray()
        val bos = ByteArrayOutputStream()
        val out = DataOutputStream(bos)
        out.write(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))
        chunk(out, "IHDR", ihdr)
        chunk(out, "IDAT", z.copyOf(zn))
        chunk(out, "IEND", ByteArray(0))
        return bos.toByteArray()
    }

    @Test
    fun `the whole link works against the real engine`(): Unit = runBlocking {
        val cfg = config()
        val link = resolve(cfg, cfg.link)
        assertEquals(LinkCrypto.fingerprint(link.pcPub), link.fp)
        step("parse + resolve")

        // The PC keeps one live code at a time, so the wrong password goes first with the same code (it has tries left).
        val bad = (Pairing(http).link(link, cfg.password + " (wrong)", "Pixel e2e (wrong)").exceptionOrNull() as PairingException).error as PairError.Refused
        assertEquals("password", bad.reason)
        assertTrue("left=${bad.left}", (bad.left ?: -1) in 0..5)
        step("wrong password refused (reason=${bad.reason}, left=${bad.left})")

        val ok = Pairing(http).link(link, cfg.password, "Pixel e2e (native)").getOrThrow()
        step("pairing with the master password")
        val session = ok.session
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val client = LinkClient(session, http, Clock.System, scope, initialSkewMs = ok.skewMs)
        try {
            val info = client.me().getOrThrow()
            assertEquals("Pixel e2e (native)", info.device)
            assertEquals(LinkCrypto.fingerprint(link.pcPub), info.pc)
            assertEquals(session.pc, info.pc)
            assertNotNull(info.name)
            assertTrue("protocol", (info.versions.v ?: 0) >= 4)
            step("me (protocol ${info.versions.v}, fingerprint matches)")

            for (m in listOf("app.state", "inbox.list", "conversations.list", "projects.list", "tasks.list")) {
                val r = client.call(m).getOrThrow()
                assertTrue("$m should answer an object or an array", r is JsonObject || r is JsonArray)
                step("call $m")
            }

            val denied = client.call("config.save", JsonObject(emptyMap())).exceptionOrNull() as LinkException
            assertEquals(403, (denied.error as LinkError.Refused).status)
            step("config.save refused (403)")

            // Live events: the stream stays up while the supervisor runs.
            client.start()
            withTimeout(15_000) { while (client.connection.value !is ConnectionState.Online) delay(50) }
            delay(3_000)
            assertTrue("the link should still be online after 3 s", client.connection.value is ConnectionState.Online)
            step("events stream online for 3 s")

            val name = client.upload(tinyPng(), "image/png").getOrThrow()
            assertTrue("upload name", name.isNotBlank())
            step("upload of a PNG")

            val back = LinkSessionCodec.decode(LinkSessionCodec.encode(session))!!
            assertEquals(session.id, back.id)
            assertArrayEquals(session.priv, back.priv)
            assertArrayEquals(session.pcPub, back.pcPub)
            assertArrayEquals(session.key, back.key)
            step("session codec round trip")

            // A method a 3.8.4 PC will learn: this PC does not list it, so the client says «unsupported», not «unlinked».
            val un = OrbApi(client).pcScreenshot().exceptionOrNull() as LinkException
            assertEquals(LinkError.Unsupported("pc.screenshot"), un.error)
            val raw = client.call("pc.screenshot").exceptionOrNull() as LinkException
            assertTrue("the PC refuses a method it does not know: ${raw.error}", raw.error is LinkError.Refused)
            step("pc.screenshot unsupported, not unlinked")
        } finally {
            client.stop()
            scope.cancel()
        }
    }
}
