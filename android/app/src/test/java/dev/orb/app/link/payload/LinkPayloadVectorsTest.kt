package dev.orb.app.link.payload

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Runs every case of vectors/link-payload.json (generated from the PC's real JS by scripts/android-vectors.mjs)
 * against the Kotlin port. Nothing is skipped: a case either matches the JS result / error message or the test fails.
 */
class LinkPayloadVectorsTest {
    private val root: JsonObject = Json.parseToJsonElement(
        checkNotNull(javaClass.getResourceAsStream("/vectors/link-payload.json")) { "vectors missing" }.reader(Charsets.UTF_8).readText(),
    ).jsonObject

    private fun cases(name: String): List<JsonObject> = root.getValue(name).jsonArray.map { it.jsonObject }

    // ---- JSON <-> Kotlin adapters (the JS call sites passed loosely typed values) ----

    private fun str(el: JsonElement?): String? = when (el) {
        null, JsonNull -> null
        // A JS number/boolean given where a string is expected is converted by String(); only used for orderBases.
        else -> el.jsonPrimitive.content
    }

    private fun num(d: Double): JsonElement =
        if (d.rem(1.0) == 0.0 && kotlin.math.abs(d) < 1e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)

    private fun nullable(s: String?): JsonElement = if (s == null) JsonNull else JsonPrimitive(s)

    private fun payloadJson(p: LinkPayload): JsonElement = buildJsonObject {
        put("v", p.v?.let { num(it) } ?: JsonNull)
        put("urls", JsonArray(p.urls.map { JsonPrimitive(it) }))
        put("pc", nullable(p.pc))
        put("code", p.code)
        put("name", nullable(p.name))
        put("role", nullable(p.role))
        put("via", p.via.wire)
    }

    /**
     * Cases where Kotlin is deliberately STRICTER than the JS oracle. The JS maps hosts with UTS46 and accepts what
     * java.net.IDN (IDNA2003) cannot reproduce exactly, so Kotlin refuses every host that is non-ASCII after
     * percent-decoding, and every `xn--` label that is not valid punycode (node accepts some of them). For these inputs
     * the expected outcome is a rejection, never the JS value. Any other disagreement is a failure: nothing is skipped.
     */
    private class Stricter(val key: String?, val value: JsonElement?)
    private val rejectBadAddress = Stricter(LinkErrors.BAD_ADDRESS, null)
    private val rejectBadQr = Stricter(LinkErrors.BAD_QR, null)
    private val stricterHosts = listOf(
        "http://用户.example", // CJK host: IDNA2003 vs UTS46
        "http://１０．０．０．１", // full-width 10.0.0.1, UTS46 maps it to an IPv4
        "http://xn--.example", "http://xn--a.example", "http://xn--zzzzzzzzzzzz.example", // node accepts these invalid labels
    )

    /** The text of the URL a case feeds in, whatever the function's input shape. */
    private fun urlOf(c: JsonObject): String? {
        val i = c["input"]
        return when (i) {
            is JsonObject -> i["address"]?.jsonPrimitive?.content
            null, JsonNull -> null
            else -> i.jsonPrimitive.content
        }?.substringBefore("/#vincular")
    }

    /** Runs [block] for every case of [name] and compares with the vector; returns the number of cases checked. */
    private fun check(name: String, stricter: Stricter? = null, block: (JsonObject) -> JsonElement): Int {
        val list = cases(name)
        assertTrue("no cases for $name", list.isNotEmpty())
        val failures = ArrayList<String>()
        var stricterSeen = 0
        for (c in list) {
            val label = "$name ${c["input"]}"
            val strict = stricter != null && urlOf(c) in stricterHosts
            if (strict) stricterSeen++
            try {
                val got = block(c)
                if (strict) {
                    if (got != stricter!!.value) failures += "$label: Kotlin must be stricter here, expected ${stricter.value ?: "a rejection"}, got $got"
                } else if (c["throws"]?.jsonPrimitive?.content == "true") failures += "$label: expected throw ${c["message"]}, got $got"
                else if (got != c["value"]) failures += "$label: expected ${c["value"]}, got $got"
            } catch (e: LinkPayloadException) {
                if (strict) {
                    if (e.key != stricter!!.key) failures += "$label: stricter key ${e.key} != ${stricter.key}"
                } else if (c["throws"]?.jsonPrimitive?.content != "true") failures += "$label: unexpected ${e.message}"
                else {
                    if (e.message != c["message"]?.jsonPrimitive?.content) failures += "$label: message ${e.message} != ${c["message"]}"
                    if (e.key != c["key"]?.jsonPrimitive?.content) failures += "$label: key ${e.key} != ${c["key"]}"
                }
            }
        }
        if (stricter != null) println("link-payload vectors: $name -> $stricterSeen cases where Kotlin is stricter")
        println("link-payload vectors: $name -> ${list.size} cases checked")
        assertTrue("$name failed:\n" + failures.joinToString("\n"), failures.isEmpty())
        return list.size
    }

    @Test fun constants() {
        val c = root.getValue("constants").jsonObject
        assertEquals(c.getValue("DEFAULT_PORT").jsonPrimitive.content, DEFAULT_PORT)
        assertEquals(c.getValue("PROTOCOL").jsonPrimitive.content, PROTOCOL.toString())
        assertEquals(c.getValue("MIN_PROTOCOL").jsonPrimitive.content, MIN_PROTOCOL.toString())
        assertEquals(c.getValue("PAIR_PROTOCOL").jsonPrimitive.content, PAIR_PROTOCOL.toString())
        assertEquals(c.getValue("CODE_ALPHABET").jsonPrimitive.content, CODE_ALPHABET)
    }

    @Test fun parseLinkPayloadVectors() {
        check("parseLinkPayload", rejectBadQr) { c ->
            val input = c["input"]
            val p = when (input) {
                is JsonObject -> parseLinkPayload(input)
                null, JsonNull -> parseLinkPayload(null as String?)
                else -> parseLinkPayload(input.jsonPrimitive.content)
            }
            payloadJson(p)
        }
    }

    @Test fun parseManualVectors() {
        check("parseManual", rejectBadAddress) { c ->
            val i = c["input"] as? JsonObject
            payloadJson(parseManual(str(i?.get("text")), str(i?.get("code")), str(i?.get("address"))))
        }
    }

    @Test fun orderBasesVectors() {
        check("orderBases") { c ->
            val list = (c["input"] as? JsonArray)?.map { str(it) }
            JsonArray(orderBases(list).map { JsonPrimitive(it) })
        }
    }

    @Test fun allowedBaseVectors() {
        check("allowedBase", Stricter(null, JsonPrimitive(false))) { c -> JsonPrimitive(allowedBase(str(c["input"]))) }
    }

    @Test fun isPrivateHostVectors() {
        check("isPrivateHost") { c -> JsonPrimitive(isPrivateHost(str(c["input"]))) }
    }

    @Test fun normalAddressVectors() {
        check("normalAddress", rejectBadAddress) { c -> JsonPrimitive(normalAddress(str(c["input"]))) }
    }

    @Test fun pairingSecretVectors() {
        check("pairingSecret") { c ->
            val i = c["input"]!!.jsonObject
            val via = LinkVia.entries.first { it.wire == i.getValue("via").jsonPrimitive.content }
            // A null code (JS) is the empty string: normalCode gives "" for both.
            JsonPrimitive(pairingSecret(LinkPayload(null, emptyList(), null, str(i["code"]) ?: "", null, null, via)))
        }
    }

    @Test fun normalCodeVectors() {
        check("normalCode") { c -> JsonPrimitive(normalCode(str(c["input"]))) }
    }

    @Test fun shortCodeLabelVectors() {
        check("shortCodeLabel") { c -> JsonPrimitive(shortCodeLabel(str(c["input"]))) }
    }

    @Test fun versionOfProtocolVectors() {
        check("versionOfProtocol") { c ->
            val i = c["input"]
            JsonPrimitive(
                when {
                    i == null || i == JsonNull -> versionOfProtocol(null as String?)
                    i.jsonPrimitive.isString -> versionOfProtocol(i.jsonPrimitive.content)
                    else -> versionOfProtocol(i.jsonPrimitive.content.toDouble())
                },
            )
        }
    }

    @Test fun updateNeededVectors() {
        check("updateNeeded") { c ->
            val args = c["input"]!!.jsonArray
            val me = args[0] as? JsonObject
            val mine = args.getOrNull(1)?.jsonPrimitive?.content?.toInt() ?: PROTOCOL
            val r = updateNeeded(JsCompat.number(me?.get("min")), mine)
            if (r == null) JsonNull else buildJsonObject { put("has", num(r.has.toDouble())); put("need", num(r.need)) }
        }
    }

    @Test fun passwordPageOkVectors() {
        check("passwordPageOk") { c ->
            val args = c["input"]!!.jsonArray
            val loc = args[0] as? JsonObject
            val app = (args.getOrNull(1) as? JsonObject)?.get("app")?.jsonPrimitive?.content == "true"
            JsonPrimitive(passwordPageOk(str(loc?.get("protocol")), str(loc?.get("hostname")), app))
        }
    }
}
