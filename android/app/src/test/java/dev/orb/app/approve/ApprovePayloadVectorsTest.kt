package dev.orb.app.approve

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** The bytes the vault signs-checks, built by the PC's JavaScript (vectors/approve.json): Kotlin builds and reads exactly these. */
class ApprovePayloadVectorsTest {
    private val root: JsonObject = Json.parseToJsonElement(
        checkNotNull(javaClass.getResourceAsStream("/vectors/approve.json")) { "vectors missing" }.reader(Charsets.UTF_8).readText(),
    ).jsonObject

    private fun unhex(h: String) = ByteArray(h.length / 2) { h.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun JsonObject.s(k: String) = getValue(k).jsonPrimitive.content

    @Test fun buildsTheSameBytesAsTheEngine() {
        val cases = root.getValue("good").jsonArray.map { it.jsonObject }
        assertEquals(4, cases.size)
        for (c in cases) {
            val p = ApprovePayload(c.s("action"), unhex(c.s("hash")), unhex(c.s("nonce")), c.s("orbId"), c.s("deviceId"), unhex(c.s("pcPub")), c.s("expires").toLong())
            assertArrayEquals(c.s("action"), unhex(c.s("payload")), p.encode())
        }
    }

    @Test fun readsWhatTheEngineBuilt() {
        for (c in root.getValue("good").jsonArray.map { it.jsonObject }) {
            val decoded = ApprovePayload.decode(unhex(c.s("payload")))
            assertNotNull(c.s("action"), decoded)
            val p = decoded!!
            assertEquals(c.s("action"), p.action)
            assertEquals(c.s("orbId"), p.orbId)
            assertEquals(c.s("deviceId"), p.deviceId)
            assertEquals(c.s("expires").toLong(), p.expires)
            assertArrayEquals(unhex(c.s("nonce")), p.nonce)
            assertArrayEquals(unhex(c.s("pcPub")), p.pcPub)
            assertArrayEquals(unhex(c.s("hash")), p.hash)
        }
    }

    @Test fun theSummaryHashesToTheSignedHash() {
        for (c in root.getValue("good").jsonArray.map { it.jsonObject }) {
            assertArrayEquals(c.s("action"), unhex(c.s("hash")), ApprovePayload.sha256(c.s("summary")))
        }
    }

    @Test fun refusesEveryMalformedPayload() {
        for ((name, hex) in root.getValue("bad").jsonObject) assertNull(name, ApprovePayload.decode(unhex(hex.jsonPrimitive.content)))
    }
}
