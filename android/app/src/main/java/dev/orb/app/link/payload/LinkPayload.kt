package dev.orb.app.link.payload

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Port of the PC's src/shared/link-payload.mjs. The rules below decide which addresses the phone may reach in plain
// http, so they follow the JS line by line and are checked against vectors generated from the JS itself
// (src/test/resources/vectors/link-payload.json). Where unsure, reject: never accept what the JS rejects.

const val DEFAULT_PORT = "3131"

/** The protocol of the link (this app, the page and the PC); see versionOfProtocol. */
const val PROTOCOL = 4
const val MIN_PROTOCOL = 2

/** A new device links only with protocol 4 or newer (the master password is sent from protocol 4 on). */
const val PAIR_PROTOCOL = 4

/** The short code typed by hand: no 0/O, 1/I/L, U. */
const val CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"

/** Message keys the UI translates; the exception message is the key itself, like the JS Error. */
object LinkErrors {
    const val NO_ADDRESS = "app.linkNoAddress"
    const val BAD_ADDRESS = "app.linkBadAddress"
    const val BAD_QR = "app.linkBadQr"
    const val OLD_QR = "app.oldQr"
    const val INSECURE = "app.linkInsecure"
    const val NO_CODE = "app.linkNoCode"
}

class LinkPayloadException(val key: String) : Exception(key)

enum class LinkVia(val wire: String) {
    QR("qr"),
    CODE("code"),

    /** The QR of a link without the master password: its code is a 128-bit one-use secret. */
    LINK("link"),

    /** The 8 characters typed for a link without the master password (the PC said so in GET /api/hello). */
    LINKCODE("linkcode"),
}

/**
 * What the QR or the typed form gives. [v] is null where the JS number was NaN (or infinite, which JSON also writes as
 * null). [pc] is null when typed by hand: the key then comes from GET /api/hello.
 */
data class LinkPayload(
    val v: Double?,
    val urls: List<String>,
    val pc: String?,
    val code: String,
    val name: String?,
    val role: String?,
    val via: LinkVia,
)

data class UpdateNeeded(val has: Int, val need: Double)

private val LINK_SECRET = Regex("[A-Za-z0-9_-]{22}") // 16 random bytes, base64url
private val PC_KEY = Regex("[A-Za-z0-9+/_-]{43}=?") // a 32-byte key in base64 (matches() = whole string, like ^…$ in JS)

private fun fail(key: String) = LinkPayloadException(key)

private fun startsWithHttpScheme(s: String): Boolean =
    s.startsWith("http://", ignoreCase = true) || s.startsWith("https://", ignoreCase = true)

/** The short code: letters and digits that cannot be confused (the PC normalizes it the same way). */
fun normalCode(code: String?): String =
    (code ?: "").uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }.replace('O', '0').take(16)

/** «100.64.1.2:3131», «casa.tail.ts.net», «http://…» → «http://100.64.1.2:3131». */
fun normalAddress(address: String?): String {
    var a = JsCompat.trim(address ?: "")
    if (a.isEmpty()) throw fail(LinkErrors.NO_ADDRESS)
    if (!startsWithHttpScheme(a)) a = "http://$a"
    val u = WhatwgUrl.parseHttp(a) ?: throw fail(LinkErrors.BAD_ADDRESS)
    // Plain http with no explicit (non-default) port gets the Orb's port.
    val port = if (u.port == null && u.scheme == "http") DEFAULT_PORT.toInt() else u.port
    return "${u.protocol}//${u.hostname}" + (if (port != null) ":$port" else "")
}

/**
 * Private addresses only travel in plain http: Tailscale (100.64.0.0/10, *.ts.net, a MagicDNS short name such as
 * «home-server»), the home network (10/8, 172.16/12, 192.168/16, *.local, *.lan, *.home.arpa) and this device.
 */
fun isPrivateHost(host: String?): Boolean {
    var h = (host ?: "").lowercase()
    if (h.startsWith("[")) h = h.substring(1)
    if (h.endsWith("]")) h = h.substring(0, h.length - 1)
    if (h == "localhost" || PRIVATE_SUFFIXES.any { h.endsWith(it) }) return true
    // Any dot-less name that is not all digits (a MagicDNS short name).
    if (h.isNotEmpty() && h.all { it in 'a'..'z' || it in '0'..'9' || it == '-' } && !h.all { it in '0'..'9' }) return true

    val parts = h.split('.')
    if (parts.size == 4 && parts.all { it.length in 1..3 && it.all { c -> c in '0'..'9' } }) {
        val n = parts.map { it.toInt() }
        if (n.any { it > 255 }) return false
        val (a, b) = n
        return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31) || (a == 100 && b in 64..127)
    }
    // IPv6: loopback, unique local (fc00::/7 as the JS tests it: fcXX: / fdXX:), link-local
    return h == "::1" || UNIQUE_LOCAL.containsMatchIn(h) || h.startsWith("fe80:")
}

private val PRIVATE_SUFFIXES = listOf(".ts.net", ".local", ".lan", ".home.arpa")
private val UNIQUE_LOCAL = Regex("^f[cd][0-9a-f]{2}:")

fun allowedBase(base: String?): Boolean {
    val u = WhatwgUrl.parseHttp(base ?: return false) ?: return false
    return u.scheme == "https" || (u.scheme == "http" && isPrivateHost(u.hostname))
}

/**
 * The order to try an Orb's addresses: https first (tailscale serve), then Tailscale, then the home network; the rest
 * keeps its order. Addresses the app may not use (plain http to a public address) are dropped.
 */
fun orderBases(list: List<String?>?): List<String> {
    val seen = HashSet<String>()
    val out = ArrayList<String>()
    for (x in list ?: emptyList()) {
        val b = try { normalAddress(x) } catch (e: LinkPayloadException) { continue }
        if (seen.add(b) && allowedBase(b)) out.add(b)
    }
    fun rank(b: String): Int {
        val u = WhatwgUrl.parseHttp(b) ?: return 2
        if (u.scheme == "https") return 0
        return if (u.hostname.startsWith("100.") || u.hostname.endsWith(".ts.net")) 1 else 2
    }
    // sortedBy is stable, which gives the JS tie-break on the original index.
    return out.sortedBy { rank(it) }
}

private val jsonParser = Json

/** The QR's text (or a pasted link) → payload. A JSON text is read like the JSON object form. */
fun parseLinkPayload(input: String?): LinkPayload {
    val q = JsCompat.trim(input ?: "")
    if (q.startsWith("{")) {
        val el = try { jsonParser.parseToJsonElement(q) } catch (e: Exception) { throw fail(LinkErrors.BAD_QR) }
        return parseLinkPayload(el as? JsonObject ?: throw fail(LinkErrors.BAD_QR))
    }
    val u = WhatwgUrl.parseHttp(q) ?: throw fail(LinkErrors.BAD_QR)
    val secret = WhatwgUrl.formGet(u.fragment, "enlace")
    val code = secret ?: WhatwgUrl.formGet(u.fragment, "vincular")
    val pc = WhatwgUrl.formGet(u.fragment, "pc")
    if (code.isNullOrEmpty()) throw fail(LinkErrors.BAD_QR)
    if (secret != null && !LINK_SECRET.matches(secret)) throw fail(LinkErrors.BAD_QR)
    if (pc.isNullOrEmpty()) throw fail(LinkErrors.OLD_QR)
    val others = (WhatwgUrl.formGet(u.fragment, "a") ?: "").split(",").filter { startsWithHttpScheme(it) }
    val v = WhatwgUrl.formGet(u.fragment, "v")?.let { JsCompat.number(it) } ?: 1.0
    return finish(v, listOf("${u.protocol}//${u.host}") + others, pc, code, WhatwgUrl.formGet(u.fragment, "n"), WhatwgUrl.formGet(u.fragment, "r"), secret != null)
}

/** The JSON form { v, urls | url, pc, code, name, role }. */
fun parseLinkPayload(q: JsonObject): LinkPayload {
    fun str(el: JsonElement?): String? = (el as? JsonPrimitive)?.takeIf { it.isString }?.content
    val rawUrls = (q["urls"] as? JsonArray)?.toList() ?: listOf(q["url"])
    val urls = rawUrls.mapNotNull { str(it) }.filter { startsWithHttpScheme(it) }
    val pc = str(q["pc"])
    val secret = str(q["link"])
    val code = secret ?: str(q["code"])
    if (urls.isEmpty() || pc == null || code == null) throw fail(LinkErrors.BAD_QR)
    val vEl = q["v"]
    val v = if (vEl == null || vEl == JsonNull) 2.0 else JsCompat.number(vEl)
    // name / role are shown as text; a non-string value from a hand-made JSON is dropped instead of displayed.
    return finish(v, urls, pc, code, str(q["name"]), str(q["role"]), secret != null)
}

private fun finish(v: Double, urls: List<String>, pc: String, code: String, name: String?, role: String?, link: Boolean = false): LinkPayload {
    val ordered = orderBases(urls)
    if (ordered.isEmpty()) throw fail(LinkErrors.INSECURE)
    if (!PC_KEY.matches(pc)) throw fail(LinkErrors.OLD_QR)
    return LinkPayload(if (v.isFinite()) v else null, ordered, pc, code, name, role, if (link) LinkVia.LINK else LinkVia.QR)
}

/** What the person typed in the «by hand» form: a pasted link (or JSON) or the short code plus the address. */
fun parseManual(text: String? = null, code: String? = null, address: String? = null): LinkPayload {
    if (text != null && JsCompat.trim(text).isNotEmpty()) return parseLinkPayload(text)
    val c = normalCode(code)
    if (c.length < 6) throw fail(LinkErrors.NO_CODE)
    val base = normalAddress(address)
    if (!allowedBase(base)) throw fail(LinkErrors.INSECURE)
    return LinkPayload(2.0, listOf(base), null, c, null, null, LinkVia.CODE)
}

/**
 * Whether a page may ask for the PC's master password: the app (its own code), https, this device, or the Tailscale
 * address. Never a page that came in plain http over the Wi-Fi.
 */
fun passwordPageOk(protocol: String?, hostname: String?, app: Boolean = false): Boolean {
    if (app || protocol == "https:") return true
    var h = (hostname ?: "").lowercase()
    if (h.startsWith("[")) h = h.substring(1)
    if (h.endsWith("]")) h = h.substring(0, h.length - 1)
    if (h == "localhost" || h == "::1" || h.startsWith("127.") || h.endsWith(".ts.net")) return true
    val parts = h.split('.')
    if (parts.size == 4 && parts[0] == "100" && parts.drop(1).all { it.length in 1..3 && it.all { c -> c in '0'..'9' } }) {
        return parts[1].toInt() in 64..127
    }
    return false
}

/** The secret both sides derive the pairing key from: the QR's code as is, the short one marked. */
fun pairingSecret(p: LinkPayload): String = if (p.via == LinkVia.CODE) "corto:${normalCode(p.code)}" else p.code

/** The app version a side of a protocol has at least. */
fun versionOfProtocol(v: Double): String = when {
    v >= 4 -> "3.8"
    v == 3.0 -> "3.6"
    v == 2.0 -> "3.5"
    else -> "3.4"
}

fun versionOfProtocol(v: Int): String = versionOfProtocol(v.toDouble())

/** Number(text): null (or undefined) is 0, anything non-numeric NaN. */
fun versionOfProtocol(v: String?): String = versionOfProtocol(if (v == null) 0.0 else JsCompat.number(v))

/** The short code shown as «ABCD-EFGH». */
fun shortCodeLabel(code: String?): String =
    (code ?: "").uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }.take(16).chunked(4).joinToString("-")

/**
 * null (fine) or the protocols (this client's and the one the Orb needs). [min] is the Orb's `min` (NaN when absent).
 */
fun updateNeeded(min: Double, mine: Int = PROTOCOL): UpdateNeeded? =
    if (min.isFinite() && min > mine) UpdateNeeded(mine, min) else null

fun updateNeeded(min: String?, mine: Int = PROTOCOL): UpdateNeeded? =
    updateNeeded(if (min == null) 0.0 else JsCompat.number(min), mine)
