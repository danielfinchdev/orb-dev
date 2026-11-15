package dev.orb.app.link.payload

import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.net.IDN
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException

/** The parts of a parsed http(s) URL that the link code reads, like JS `URL`. */
internal class ParsedUrl(val scheme: String, val hostname: String, val port: Int?, val fragment: String) {
    val protocol: String get() = "$scheme:"

    /** Like URL.host: the hostname plus the port unless it is the scheme's default. */
    val host: String get() = if (port == null) hostname else "$hostname:$port"
}

/**
 * A small WHATWG URL parser for http and https only (java.net.URI and OkHttp's HttpUrl normalize hosts differently from
 * the PC's `new URL`: IPv4 forms such as 0x7f.1 or 2130706433, default ports, punycode, trailing dots).
 * Every other scheme returns null: the callers reject them anyway. Where this port is unsure it fails, never accepts.
 */
internal object WhatwgUrl {
    fun parseHttp(input: String): ParsedUrl? {
        var a = 0
        var b = input.length
        while (a < b && input[a] <= ' ') a++
        while (b > a && input[b - 1] <= ' ') b--
        val s = input.substring(a, b).filter { it != '\t' && it != '\n' && it != '\r' }

        val colon = s.indexOf(':')
        if (colon <= 0) return null
        val schemeRaw = s.substring(0, colon)
        if (!schemeRaw[0].isAsciiLetter() || !schemeRaw.all { it.isAsciiLetter() || it in '0'..'9' || it == '+' || it == '-' || it == '.' }) return null
        val scheme = schemeRaw.lowercase()
        if (scheme != "http" && scheme != "https") return null

        var pos = colon + 1
        while (pos < s.length && (s[pos] == '/' || s[pos] == '\\')) pos++
        var end = pos
        while (end < s.length && s[end] != '/' && s[end] != '\\' && s[end] != '?' && s[end] != '#') end++
        val hash = s.indexOf('#', end)
        val fragment = if (hash >= 0) s.substring(hash + 1) else ""

        // Credentials are dropped; the last '@' wins.
        val auth = s.substring(pos, end)
        val hostPort = auth.substring(auth.lastIndexOf('@') + 1)

        val hostText: String
        val portText: String
        if (hostPort.startsWith("[")) {
            val close = hostPort.indexOf(']')
            if (close < 0) return null
            hostText = hostPort.substring(0, close + 1)
            val after = hostPort.substring(close + 1)
            portText = when {
                after.isEmpty() -> ""
                after[0] == ':' -> after.substring(1)
                else -> return null
            }
        } else {
            val c = hostPort.indexOf(':')
            hostText = if (c < 0) hostPort else hostPort.substring(0, c)
            portText = if (c < 0) "" else hostPort.substring(c + 1)
        }
        if (hostText.isEmpty()) return null

        var port: Int? = null
        if (portText.isNotEmpty()) {
            if (!portText.all { it in '0'..'9' }) return null
            val digits = portText.trimStart('0')
            if (digits.length > 5) return null
            val value = if (digits.isEmpty()) 0 else digits.toInt()
            if (value > 65535) return null
            port = value
        }
        if ((scheme == "http" && port == 80) || (scheme == "https" && port == 443)) port = null

        val hostname = if (hostText.startsWith("[")) {
            val pieces = parseIPv6(hostText.substring(1, hostText.length - 1)) ?: return null
            "[" + serializeIPv6(pieces) + "]"
        } else {
            parseDomainHost(hostText) ?: return null
        }
        return ParsedUrl(scheme, hostname, port, fragment)
    }

    private fun Char.isAsciiLetter() = this in 'a'..'z' || this in 'A'..'Z'

    // ---- hosts ----

    private const val FORBIDDEN_HOST = "#%/:<>?@[\\]^|"

    private fun parseDomainHost(raw: String): String? {
        val decoded = percentDecodeUtf8Strict(raw) ?: return null
        // The PC maps hosts with UTS46; java.net.IDN is IDNA2003 and disagrees on joiners, deviation characters and
        // full-width forms. Any host still non-ASCII after percent-decoding is refused instead of guessed at: the link
        // rules only ever need ASCII hosts (IPs, ts.net, .local names), and refusing is the safe side of a mismatch.
        if (decoded.any { it.code >= 128 }) return null
        var ascii = decoded.lowercase()
        if (ascii.isEmpty()) return null
        if (ascii.any { it.code <= 0x20 || it.code == 0x7F || it in FORBIDDEN_HOST }) return null
        // A label already in punycode must be valid punycode that round-trips; the PC rejects invalid ones.
        for (label in ascii.split('.')) {
            if (label.startsWith("xn--")) {
                val ok = try {
                    val u = IDN.toUnicode(label)
                    u != label && IDN.toASCII(u).lowercase() == label
                } catch (e: IllegalArgumentException) {
                    false
                }
                if (!ok) return null
            }
        }
        if (endsInNumber(ascii)) ascii = parseIPv4(ascii) ?: return null
        return ascii
    }

    private fun percentDecodeUtf8Strict(s: String): String? {
        if (!s.contains('%')) return s
        val bytes = ByteArrayOutputStream()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '%' && i + 2 < s.length && hexVal(s[i + 1].code) >= 0 && hexVal(s[i + 2].code) >= 0) {
                bytes.write(hexVal(s[i + 1].code) * 16 + hexVal(s[i + 2].code))
                i += 3
            } else {
                val cp = s.codePointAt(i)
                bytes.write(String(Character.toChars(cp)).toByteArray(Charsets.UTF_8))
                i += Character.charCount(cp)
            }
        }
        return try {
            Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (e: CharacterCodingException) {
            null
        }
    }

    private fun hexVal(c: Int): Int = when (c) {
        in '0'.code..'9'.code -> c - '0'.code
        in 'a'.code..'f'.code -> c - 'a'.code + 10
        in 'A'.code..'F'.code -> c - 'A'.code + 10
        else -> -1
    }

    private fun endsInNumber(host: String): Boolean {
        val parts = host.split('.').toMutableList()
        if (parts.last().isEmpty()) {
            if (parts.size == 1) return false
            parts.removeAt(parts.size - 1)
        }
        val last = parts.last()
        if (last.isNotEmpty() && last.all { it in '0'..'9' }) return true
        return parseIPv4Number(last) != null
    }

    private fun parseIPv4Number(text: String): BigInteger? {
        if (text.isEmpty()) return null
        var s = text
        var radix = 10
        if (s.length >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
            s = s.substring(2); radix = 16
        } else if (s.length >= 2 && s[0] == '0') {
            s = s.substring(1); radix = 8
        }
        if (s.isEmpty()) return BigInteger.ZERO
        if (!s.all { it.code < 128 && Character.digit(it, radix) >= 0 }) return null
        return BigInteger(s, radix)
    }

    private fun parseIPv4(host: String): String? {
        val parts = host.split('.').toMutableList()
        if (parts.last().isEmpty() && parts.size > 1) parts.removeAt(parts.size - 1)
        if (parts.size > 4) return null
        val numbers = parts.map { parseIPv4Number(it) ?: return null }
        val b255 = BigInteger.valueOf(255)
        val b256 = BigInteger.valueOf(256)
        if (numbers.dropLast(1).any { it > b255 }) return null
        if (numbers.last() >= b256.pow(5 - numbers.size)) return null
        var ipv4 = numbers.last()
        numbers.dropLast(1).forEachIndexed { i, n -> ipv4 += n.multiply(b256.pow(3 - i)) }
        val v = ipv4.toLong()
        return "${(v shr 24) and 255}.${(v shr 16) and 255}.${(v shr 8) and 255}.${v and 255}"
    }

    private fun parseIPv6(input: String): IntArray? {
        val a = IntArray(8)
        var pi = 0
        var compress = -1
        var p = 0
        val n = input.length
        fun c(): Int = if (p < n) input[p].code else -1
        fun isDigit(x: Int) = x in '0'.code..'9'.code

        if (c() == ':'.code) {
            if (p + 1 >= n || input[p + 1] != ':') return null
            p += 2; pi++; compress = pi
        }
        while (c() != -1) {
            if (pi == 8) return null
            if (c() == ':'.code) {
                if (compress != -1) return null
                p++; pi++; compress = pi
                continue
            }
            var value = 0
            var length = 0
            while (length < 4 && c() != -1 && hexVal(c()) >= 0) {
                value = value * 16 + hexVal(c()); p++; length++
            }
            if (c() == '.'.code) {
                if (length == 0) return null
                p -= length
                if (pi > 6) return null
                var seen = 0
                while (c() != -1) {
                    var piece = -1
                    if (seen > 0) {
                        if (c() == '.'.code && seen < 4) p++ else return null
                    }
                    if (!isDigit(c())) return null
                    while (isDigit(c())) {
                        val num = c() - '0'.code
                        piece = when (piece) {
                            -1 -> num
                            0 -> return null
                            else -> piece * 10 + num
                        }
                        if (piece > 255) return null
                        p++
                    }
                    a[pi] = a[pi] * 0x100 + piece
                    seen++
                    if (seen == 2 || seen == 4) pi++
                }
                if (seen != 4) return null
                break
            } else if (c() == ':'.code) {
                p++
                if (c() == -1) return null
            } else if (c() != -1) {
                return null
            }
            a[pi] = value
            pi++
        }
        if (compress != -1) {
            var swaps = pi - compress
            pi = 7
            while (pi != 0 && swaps > 0) {
                val t = a[compress + swaps - 1]
                a[compress + swaps - 1] = a[pi]
                a[pi] = t
                pi--; swaps--
            }
        } else if (pi != 8) {
            return null
        }
        return a
    }

    private fun serializeIPv6(a: IntArray): String {
        // The first longest run of zero pieces (length > 1) becomes "::".
        var best = -1
        var bestLen = 1
        var i = 0
        while (i < 8) {
            if (a[i] == 0) {
                var j = i
                while (j < 8 && a[j] == 0) j++
                if (j - i > bestLen) { best = i; bestLen = j - i }
                i = j
            } else {
                i++
            }
        }
        val sb = StringBuilder()
        var ignore0 = false
        for (k in 0..7) {
            if (ignore0 && a[k] == 0) continue else if (ignore0) ignore0 = false
            if (best == k) {
                sb.append(if (k == 0) "::" else ":")
                ignore0 = true
                continue
            }
            sb.append(Integer.toHexString(a[k]))
            if (k != 7) sb.append(':')
        }
        return sb.toString()
    }

    // ---- application/x-www-form-urlencoded (URLSearchParams) ----

    /** URLSearchParams(text).get(name): first match, '+' is a space, %XX is UTF-8; null when absent. */
    fun formGet(text: String, name: String): String? {
        for (pair in text.split('&')) {
            if (pair.isEmpty()) continue
            val eq = pair.indexOf('=')
            val k = if (eq < 0) pair else pair.substring(0, eq)
            val v = if (eq < 0) "" else pair.substring(eq + 1)
            if (formDecode(k) == name) return formDecode(v)
        }
        return null
    }

    private fun formDecode(s: String): String {
        val plus = s.replace('+', ' ')
        if (!plus.contains('%')) return plus
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < plus.length) {
            val c = plus[i]
            if (c == '%' && i + 2 < plus.length && hexVal(plus[i + 1].code) >= 0 && hexVal(plus[i + 2].code) >= 0) {
                out.write(hexVal(plus[i + 1].code) * 16 + hexVal(plus[i + 2].code))
                i += 3
            } else {
                val cp = plus.codePointAt(i)
                out.write(String(Character.toChars(cp)).toByteArray(Charsets.UTF_8))
                i += Character.charCount(cp)
            }
        }
        // Invalid UTF-8 becomes U+FFFD, like TextDecoder in the JS URLSearchParams.
        return String(out.toByteArray(), Charsets.UTF_8)
    }
}
