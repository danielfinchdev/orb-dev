package dev.orb.app

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import java.io.ByteArrayOutputStream

/**
 * «Compartir con Orb»: what another app shares (text and pictures) as { text?, files?: [{ name, type, data (base64) }] }
 * for the page (src/ui/lib/app-bridge.js uploads the pictures to the PC). At most 10 pictures of 10 MB each.
 */
object ShareIntent {
  private const val MAX_FILES = 10
  private const val MAX_BYTES = 10 * 1024 * 1024

  fun isShare(intent: Intent?): Boolean = intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

  fun read(context: Context, intent: Intent?): JSObject? {
    if (intent == null || !isShare(intent)) return null
    val out = JSObject()
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    val all = StringBuilder()
    if (!subject.isNullOrEmpty() && (text == null || !text.toString().contains(subject))) all.append(subject).append('\n')
    if (text != null) all.append(text)
    if (all.isNotEmpty()) out.put("text", all.toString().trim())
    val uris = mutableListOf<Uri>()
    if (intent.action == Intent.ACTION_SEND) {
      streamOf(intent)?.let { uris.add(it) }
    } else {
      streamsOf(intent)?.let { uris.addAll(it) }
    }
    val files = JSArray()
    val cr = context.contentResolver
    for (u in uris) {
      if (files.length() >= MAX_FILES) break
      val type = cr.getType(u)
      if (type == null || !type.startsWith("image/")) continue
      val data = readAll(cr, u) ?: continue
      val f = JSObject()
      f.put("name", nameOf(cr, u))
      f.put("type", type)
      f.put("data", Base64.encodeToString(data, Base64.NO_WRAP))
      files.put(f)
    }
    if (files.length() > 0) out.put("files", files)
    return if (out.length() > 0) out else null
  }

  @Suppress("DEPRECATION")
  private fun streamOf(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streamsOf(intent: Intent): List<Uri>? =
    if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)

  private fun readAll(cr: ContentResolver, u: Uri): ByteArray? = try {
    cr.openInputStream(u)?.use { input ->
      val buf = ByteArrayOutputStream()
      val chunk = ByteArray(64 * 1024)
      var total = 0
      while (true) {
        val n = input.read(chunk)
        if (n <= 0) break
        total += n
        if (total > MAX_BYTES) return null
        buf.write(chunk, 0, n)
      }
      buf.toByteArray()
    }
  } catch (e: Exception) {
    null
  }

  private fun nameOf(cr: ContentResolver, u: Uri): String {
    try {
      cr.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0)?.let { return it }
      }
    } catch (ignored: Exception) {
    }
    return u.lastPathSegment ?: "imagen"
  }
}
