package dev.orb.app

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL

/** The end-to-end encryption of src/core/mobile-crypto.mjs, in Rust (src-tauri/src/phone_crypto.rs). */
object PhoneCrypto {
  init {
    System.loadLibrary("orb_lib")
  }

  /** A JSON message sealed for the PC → {"n","c"}, or null. priv and pc: this phone's link (base64url). */
  @JvmStatic external fun seal(priv: String, pc: String, aad: String, json: String): String?

  /** The PC's sealed answer → its JSON text, or null (changed, another key or another purpose). */
  @JvmStatic external fun open(priv: String, pc: String, aad: String, n: String, c: String): String?
}

/**
 * One call to the linked PC without the page (a notification's «Aprobar», «Rechazar» or «Responder» with the app closed),
 * exactly as src/ui/lib/web-bridge.js › post makes it: POST <address>/api/call with X-Orb-Device and
 * seal({ t, m: 'call', b: { method, params } }, 'orb:peticion:<id>'), the answer opened with 'orb:respuesta:<id>' and
 * the request's nonce echoed. The linked PC's addresses are tried from the one that answered last; a call that ran out of
 * time is never sent to the next address (the PC may have done it). The PC checks it as any call of this phone.
 * Everything within [BUDGET_MS]: a notification's button runs in a broadcast receiver, which Android stops after 10 s.
 */
object PcCall {
  private const val CONNECT_MS = 4_000
  private const val BUDGET_MS = 9_000L

  class Failed(message: String, val unlinked: Boolean = false) : Exception(message)

  private class Link(val id: String, val priv: String, val pc: String, val urls: List<String>, val at: Int)

  private fun link(context: Context): Link? {
    // The Keystore busy right now: «try again» (the phone stays linked).
    val raw = try { SecureStore.get(context, "orb.movil") } catch (e: SecureStore.Busy) { throw Failed("timeout") } ?: return null
    return try {
      val o = JSONObject(raw)
      val urls = o.optJSONArray("urls") ?: return null
      val list = (0 until urls.length()).map { urls.getString(it) }.filter { it.startsWith("http://") || it.startsWith("https://") }
      if (list.isEmpty()) null else Link(o.getString("id"), o.getString("priv"), o.getString("pc"), list, o.optInt("at", 0))
    } catch (e: Exception) {
      null
    }
  }

  private class Answer(val status: Int, val body: String)

  private fun post(url: String, device: String, body: String, left: Int): Answer {
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.requestMethod = "POST"
      conn.connectTimeout = minOf(CONNECT_MS, left)
      conn.readTimeout = left
      conn.doOutput = true
      conn.useCaches = false
      conn.instanceFollowRedirects = false
      conn.setRequestProperty("Content-Type", "application/json")
      conn.setRequestProperty("X-Orb-Device", device)
      conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val status = conn.responseCode
      val stream = if (status >= 400) conn.errorStream else conn.inputStream
      val text = stream?.use { s -> s.readBytes().toString(Charsets.UTF_8) } ?: ""
      return Answer(status, text)
    } finally {
      conn.disconnect()
    }
  }

  /**
   * Runs method(params) on the PC; its result as JSON text. Throws Failed with the PC's own words, or one of notLinked,
   * offline, timeout, badAnswer.
   */
  fun call(context: Context, method: String, params: JSONObject): String {
    val link = link(context) ?: throw Failed("notLinked", unlinked = true)
    val until = System.currentTimeMillis() + BUDGET_MS
    var skew = 0L
    val n = link.urls.size
    var i = 0
    var retried = false
    while (true) {
      val base = link.urls[(link.at + i) % n].trimEnd('/')
      val message = JSONObject().put("t", System.currentTimeMillis() + skew).put("m", "call").put("b", JSONObject().put("method", method).put("params", params))
      val box = PhoneCrypto.seal(link.priv, link.pc, "orb:peticion:${link.id}", message.toString()) ?: throw Failed("badAnswer")
      val nonce = JSONObject(box).getString("n")
      val left = (until - System.currentTimeMillis()).toInt()
      if (left < 1_000) throw Failed("offline")
      val answer = try {
        post("$base/api/call", link.id, box, left)
      } catch (e: SocketTimeoutException) {
        // Connected but no answer in time: the PC may have done it. Not sent again.
        if (e.message?.contains("connect", ignoreCase = true) != true) throw Failed("timeout")
        null
      } catch (e: IOException) {
        null
      }
      if (answer == null) {
        i++
        if (i >= n) throw Failed("offline")
        continue
      }
      val data = try { JSONObject(answer.body) } catch (e: Exception) { JSONObject() }
      // The phone's clock is off: once more with the PC's time.
      if (answer.status == 409 && data.has("now") && !retried) {
        skew = data.getLong("now") - System.currentTimeMillis()
        retried = true
        continue
      }
      if (answer.status == 401) throw Failed(data.optString("error", "401"), unlinked = true)
      if (answer.status !in 200..299) throw Failed(data.optString("error", "HTTP ${answer.status}"))
      val opened = PhoneCrypto.open(link.priv, link.pc, "orb:respuesta:${link.id}", data.optString("n"), data.optString("c")) ?: throw Failed("badAnswer")
      val msg = JSONObject(opened)
      if (msg.optString("r") != nonce) throw Failed("badAnswer")
      if (!msg.optBoolean("ok")) throw Failed(msg.optString("error", "error"))
      return msg.opt("result")?.toString() ?: "null"
    }
  }
}
