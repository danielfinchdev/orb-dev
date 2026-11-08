package dev.orb.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.speech.RecognizerIntent
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Orb's own bits of Android, for the page (src/ui/lib/app-bridge.js: invoke('plugin:orb-native|…') and its events):
 * - secure_get/set/remove: the key store (SecureStore: the same Keystore key and file as Orb 3.8.0);
 * - take_shared and the «shared» event: «Compartir con Orb» (ShareIntent);
 * - info: the phone's model, for the name of the linked device; minimize: to the background instead of closing;
 * - scan_qr: Google's code scanner (no camera permission for the app, nothing kept); dictate: Android's own speech
 *   recognition (its own window and microphone permission);
 * - notify, notify_clear, notify_permission, take_note_action and the «note» event: the chats' notifications (Notes).
 * Android's back button reaches the page through Tauri's own app plugin (onBackButtonPress).
 */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class OrbNativePlugin(private val activity: Activity) : Plugin(activity) {
  private var pendingShare: JSObject? = null // shared before the page asked for it
  private var pendingNote: JSONObject? = null // a notification that opened the app, before the page asked for it

  companion object {
    private var current: WeakReference<OrbNativePlugin>? = null

    /** A notification's button was answered in the background (Notes.run): the page forgets that chat's lines. */
    fun noteDone(note: String) {
      val plugin = current?.get() ?: return
      plugin.activity.runOnUiThread { plugin.trigger("noteDone", JSObject().put("note", note)) }
    }
  }

  override fun load(webView: WebView) {
    current = WeakReference(this)
    val intent = activity.intent
    pendingShare = ShareIntent.read(activity, intent)
    pendingNote = Notes.fromIntent(intent)
    // Taken once: not again after the activity is recreated.
    if (pendingShare != null || pendingNote != null) activity.intent = Intent(activity, MainActivity::class.java)
  }

  override fun onNewIntent(intent: Intent) {
    ShareIntent.read(activity, intent)?.let { trigger("shared", it) }
    Notes.fromIntent(intent)?.let { note ->
      if (hasListener("note")) trigger("note", JSObject.fromJSONObject(note)) else pendingNote = note
    }
  }

  // ---- key store

  @Command
  fun secureGet(invoke: Invoke) {
    val k = invoke.getArgs().getString("key", null)
    val out = JSObject()
    if (k != null) SecureStore.get(activity, k)?.let { out.put("value", it) }
    invoke.resolve(out)
  }

  @Command
  fun secureSet(invoke: Invoke) {
    val args = invoke.getArgs()
    val k = args.getString("key", null)
    val v = args.getString("value", null)
    if (k == null || v == null) return invoke.reject("falta la clave o el valor")
    try {
      SecureStore.set(activity, k, v)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("no se pudo guardar: ${e.message}")
    }
  }

  @Command
  fun secureRemove(invoke: Invoke) {
    invoke.getArgs().getString("key", null)?.let { SecureStore.remove(activity, it) }
    invoke.resolve()
  }

  // ---- the app

  @Command
  fun minimize(invoke: Invoke) {
    activity.runOnUiThread { activity.moveTaskToBack(true) }
    invoke.resolve()
  }

  @Command
  fun info(invoke: Invoke) {
    val maker = Build.MANUFACTURER ?: ""
    val model = Build.MODEL ?: "Android"
    invoke.resolve(JSObject().put("model", if (model.lowercase().startsWith(maker.lowercase())) model else "$maker $model".trim()))
  }

  @Command
  fun takeShared(invoke: Invoke) {
    val out = pendingShare ?: JSObject()
    pendingShare = null
    invoke.resolve(out)
  }

  // ---- QR

  /** → { value } with the QR's text; {} closed without reading; rejected with code «preparing» while Google installs it. */
  @Command
  fun scanQr(invoke: Invoke) {
    activity.runOnUiThread {
      val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
      val scanner = GmsBarcodeScanning.getClient(activity, options)
      scanner.startScan()
        .addOnSuccessListener { code -> invoke.resolve(JSObject().put("value", code.rawValue)) }
        .addOnCanceledListener { invoke.resolve(JSObject()) }
        .addOnFailureListener { e ->
          if (e is MlKitException && e.errorCode == MlKitException.UNAVAILABLE) {
            ModuleInstall.getClient(activity).installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build())
            invoke.reject("preparing", "preparing")
          } else {
            invoke.reject(e.message ?: "scan")
          }
        }
    }
  }

  // ---- dictation

  /** → { text } (empty: nothing heard or closed); rejected with code «unavailable» without speech recognition. */
  @Command
  fun dictate(invoke: Invoke) {
    val lang = if (invoke.getArgs().getString("lang", "es") == "en") "en-US" else "es-ES"
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    if (intent.resolveActivity(activity.packageManager) == null) return invoke.reject("unavailable", "unavailable")
    startActivityForResult(invoke, intent, "dictated")
  }

  @ActivityCallback
  private fun dictated(invoke: Invoke, result: ActivityResult) {
    val heard = if (result.resultCode == Activity.RESULT_OK) result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() else null
    invoke.resolve(JSObject().put("text", heard ?: ""))
  }

  // ---- notifications

  @Command
  fun notify(invoke: Invoke) {
    try {
      Notes.show(activity, invoke.getArgs())
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "notify")
    }
  }

  @Command
  fun notifyClear(invoke: Invoke) {
    try { Notes.clear(activity) } catch (ignored: Exception) { }
    invoke.resolve()
  }

  /** → { granted }: asks once (Android 13+); before Android 13 whether notifications are on for Orb. */
  @Command
  fun notifyPermission(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      return invoke.resolve(JSObject().put("granted", NotificationManagerCompat.from(activity).areNotificationsEnabled()))
    }
    requestPermissionForAlias("notifications", invoke, "notifyPermissionDone")
  }

  @PermissionCallback
  private fun notifyPermissionDone(invoke: Invoke) {
    val ok = ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    invoke.resolve(JSObject().put("granted", ok && NotificationManagerCompat.from(activity).areNotificationsEnabled()))
  }

  /** The notification (or its button) that opened the app: { action, note } once, or {}. */
  @Command
  fun takeNoteAction(invoke: Invoke) {
    val out = pendingNote?.let { JSObject.fromJSONObject(it) } ?: JSObject()
    pendingNote = null
    invoke.resolve(out)
  }
}
