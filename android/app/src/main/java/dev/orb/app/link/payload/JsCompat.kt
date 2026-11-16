package dev.orb.app.link.payload

import java.math.BigInteger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The few JavaScript semantics the PC code relies on (String.prototype.trim, Number(...)). Kotlin's own
 * trim()/toDouble() differ, and the link rules must decide exactly like the PC's JS.
 */
internal object JsCompat {
    // ECMAScript WhiteSpace + LineTerminator; Kotlin's isWhitespace() disagrees on U+00A0, U+FEFF and U+001C..1F.
    private fun isJsSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }

    fun trim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isJsSpace(s[a])) a++
        while (b > a && isJsSpace(s[b - 1])) b--
        return s.substring(a, b)
    }

    private val DECIMAL = Regex("[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?")

    /** Number(string): NaN when it is not a numeric literal; "" is 0. */
    fun number(text: String): Double {
        val t = trim(text)
        if (t.isEmpty()) return 0.0
        when (t) {
            "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
            "-Infinity" -> return Double.NEGATIVE_INFINITY
        }
        if (t.length > 2 && t[0] == '0') {
            val radix = when (t[1]) {
                'x', 'X' -> 16
                'o', 'O' -> 8
                'b', 'B' -> 2
                else -> 0
            }
            if (radix != 0) {
                val digits = t.substring(2)
                return if (digits.all { it.code < 128 && Character.digit(it, radix) >= 0 }) BigInteger(digits, radix).toDouble() else Double.NaN
            }
        }
        return if (DECIMAL.matches(t)) t.toDouble() else Double.NaN
    }

    /** Number(value) for a decoded JSON value; null stands for an absent property (undefined). */
    fun number(el: JsonElement?): Double = when (el) {
        null -> Double.NaN
        JsonNull -> 0.0
        is JsonPrimitive -> when {
            el.isString -> number(el.content)
            el.content == "true" -> 1.0
            el.content == "false" -> 0.0
            else -> el.content.toDoubleOrNull() ?: Double.NaN
        }
        // Number([]) / Number({}) can differ from NaN in JS, but these values never decide acceptance.
        is JsonArray, is JsonObject -> Double.NaN
    }
}
