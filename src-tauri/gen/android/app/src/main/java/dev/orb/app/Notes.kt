package dev.orb.app

import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * The chats' notifications (src/shared/notes.mjs builds them on the PC; src/ui/lib/app-bridge.js hands them here), as a
 * messaging app's: the white «o•» (ic_stat_orb), Orbe's picture, one per chat with its last lines, and its buttons.
 *
 * A button that the page worked out a call for («Aprobar» / «Rechazar» a permission, «Responder» with the text typed in
 * the notification) is answered right there by [NoteReceiver], also with the app closed: the call goes to the PC
 * natively (PcCall), and the notification then says it was done (or why not). Any other button, and a tap, open the app,
 * which does it (OrbNativePlugin › take_note_action, the «note» event).
 *
 * Safety (review Android A1/M1/M3): the buttons that act need the phone unlocked (setAuthenticationRequired, Android 12+;
 * before that NoteReceiver itself refuses while the phone is locked); every intent, also the ones that open the app,
 * carries only a one-time token of a job kept here (another app can open MainActivity, which is exported, but cannot
 * make up a notification's action); and the jobs of a notification go together when one is used, all of them when the
 * chats' notifications are cleared or the phone is unlinked, and any older than a day is refused.
 *
 * spec = { id, title, body, largeBody?, lines?, summary?, group?, largeIcon?, note (the page's JSON), silent?,
 *          actions: [{ id, title, input?, call?: { method, params, text? } }],
 *          words: { sending, sent, allowed, denied, failed ("…{error}…"), locked, err_offline, err_timeout, err_notLinked, err_badAnswer } }
 */
object Notes {
  const val CHANNEL = "orb-chats"
  private const val EXTRA_TOKEN = "dev.orb.app.noteToken"
  // What a button does lives here (app-private), not in its PendingIntent: a «Responder» intent is mutable (Android fills
  // in the typed text), so whoever can see notifications could change its extras; only its one-time token travels.
  private const val PENDING = "orb.notes"
  private const val MAX_PENDING = 200
  private const val MAX_AGE_MS = 24L * 60 * 60 * 1000
  const val REPLY_KEY = "orb-reply"
  // src/shared/notes.mjs › NOTE_IDS
  const val FIRST_ID = 20_000
  const val ID_COUNT = 10_000
  private const val COLOR = 0xFF5B6EE8.toInt()

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Chats", NotificationManager.IMPORTANCE_HIGH))
    }
    // Orb 3.8.0's (Capacitor's LocalNotifications «default»): unused since 3.8.1, it would stay in Android's settings.
    if (nm.getNotificationChannel("default") != null) nm.deleteNotificationChannel("default")
  }

  private fun flags(mutable: Boolean): Int =
    PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)

  /** Opens the app with { action, note } for the page (a tap: action "tap"); only a token travels in the intent. */
  private fun openIntent(context: Context, id: Int, slot: Int, action: String, note: String): PendingIntent {
    val job = JSONObject().put("id", id).put("open", true).put("action", action).put("note", note).put("at", System.currentTimeMillis())
    val intent = Intent(context, MainActivity::class.java)
      .setAction("dev.orb.app.NOTE.$id.$slot")
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      .putExtra(EXTRA_TOKEN, keep(context, job))
    return PendingIntent.getActivity(context, id * 8 + slot, intent, flags(mutable = false))
  }

  fun show(context: Context, spec: JSONObject) {
    channel(context)
    val id = spec.getInt("id")
    drop(context, id) // the buttons of the notification this one replaces
    val note = spec.optString("note", "{}")
    val words = spec.optJSONObject("words") ?: JSONObject()
    val title = spec.optString("title", "Orb")
    val group = spec.optString("group", "")
    val b = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_orb)
      .setColor(COLOR)
      .setContentTitle(title)
      .setContentText(spec.optString("body", ""))
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openIntent(context, id, 0, "tap", note))
    if (spec.optBoolean("silent")) b.setSilent(true)
    if (group.isNotEmpty()) b.setGroup(group)
    val lines = spec.optJSONArray("lines")
    if (lines != null && lines.length() > 1) {
      val style = NotificationCompat.InboxStyle()
      for (i in 0 until lines.length()) style.addLine(lines.optString(i))
      spec.optString("summary").takeIf { it.isNotEmpty() }?.let { style.setSummaryText(it) }
      b.setStyle(style)
    } else {
      b.setStyle(NotificationCompat.BigTextStyle().bigText(spec.optString("largeBody", spec.optString("body", ""))))
    }
    spec.optString("largeIcon").takeIf { it.isNotEmpty() }?.let { name ->
      val res = context.resources.getIdentifier(name, "drawable", context.packageName)
      if (res != 0) BitmapFactory.decodeResource(context.resources, res)?.let { b.setLargeIcon(it) }
    }
    val actions = spec.optJSONArray("actions") ?: JSONArray()
    for (i in 0 until minOf(actions.length(), 3)) {
      val a = actions.getJSONObject(i)
      val actionId = a.getString("id")
      val label = a.optString("title", actionId)
      val call = a.optJSONObject("call")
      if (call == null) {
        b.addAction(0, label, openIntent(context, id, i + 1, actionId, note))
        continue
      }
      val job = JSONObject().put("id", id).put("action", actionId).put("note", note).put("call", call).put("words", words)
        .put("title", title).put("group", group).put("body", spec.optString("body", "")).put("at", System.currentTimeMillis())
      val intent = Intent(context, NoteReceiver::class.java)
        .setAction("dev.orb.app.NOTE_ACTION.$id.$i")
        .putExtra(EXTRA_TOKEN, keep(context, job))
      val input = a.optBoolean("input") && call.has("text")
      val pending = PendingIntent.getBroadcast(context, id * 8 + i + 1, intent, flags(mutable = input))
      // Only with the phone unlocked (Android asks first): nobody can approve from the lock screen.
      val action = NotificationCompat.Action.Builder(0, label, pending).setAuthenticationRequired(true)
      if (input) action.addRemoteInput(RemoteInput.Builder(REPLY_KEY).setLabel(label).build()).setAllowGeneratedReplies(false)
      b.addAction(action.build())
    }
    try {
      NotificationManagerCompat.from(context).notify(id, b.build())
    } catch (e: SecurityException) {
      // Notifications not allowed (Ajustes › Notificaciones turned them off): nothing to show.
    }
  }

  /** A notification that only says something (sent, allowed, failed…); tapping it opens the chat. */
  internal fun say(context: Context, id: Int, title: String, text: String, note: String, group: String, gone: Boolean) {
    channel(context)
    val b = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_stat_orb)
      .setColor(COLOR)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setAutoCancel(true)
      .setSilent(true)
      .setContentIntent(openIntent(context, id, 0, "tap", note))
    if (group.isNotEmpty()) b.setGroup(group)
    if (gone) b.setTimeoutAfter(4_000)
    try {
      NotificationManagerCompat.from(context).notify(id, b.build())
    } catch (e: SecurityException) {
    }
  }

  /** Removes the chats' notifications on show (back in the app: it shows the chats themselves), and their jobs. */
  fun clear(context: Context) {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    for (s in nm.activeNotifications) if (s.id >= FIRST_ID && s.id < FIRST_ID + ID_COUNT) nm.cancel(s.id)
    forget(context)
  }

  /** The jobs of one notification go. */
  @Synchronized
  private fun drop(context: Context, id: Int) {
    val prefs = context.getSharedPreferences(PENDING, Context.MODE_PRIVATE)
    val edit = prefs.edit()
    for ((k, v) in prefs.all) {
      val job = (v as? String)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
      if (job == null || job.optInt("id", -1) == id) edit.remove(k)
    }
    edit.apply()
  }

  /** Every button's job goes (the notifications were cleared, or the phone was unlinked: none may reach a PC now). */
  @Synchronized
  fun forget(context: Context) {
    context.getSharedPreferences(PENDING, Context.MODE_PRIVATE).edit().clear().commit()
  }

  /** What a notification that opened the app was for: { action, note } (note: the page's JSON), or null: only with a
   *  token of a job kept here for opening (any other app can start MainActivity with made-up extras). */
  fun fromIntent(context: Context, intent: Intent?): JSONObject? {
    val token = intent?.getStringExtra(EXTRA_TOKEN) ?: return null
    if (intent.component?.className?.endsWith("MainActivity") != true) return null
    val job = take(context, token) ?: return null
    if (!job.optBoolean("open")) return null
    return JSONObject().put("action", job.optString("action", "tap")).put("note", job.optString("note", "{}"))
  }

  /** Keeps a button's job; → its one-time token. The oldest go beyond MAX_PENDING. */
  @Synchronized
  private fun keep(context: Context, job: JSONObject): String {
    val prefs = context.getSharedPreferences(PENDING, Context.MODE_PRIVATE)
    val token = UUID.randomUUID().toString()
    val edit = prefs.edit().putString(token, job.toString())
    val all = prefs.all
    if (all.size >= MAX_PENDING) {
      all.entries.sortedBy { (it.value as? String)?.let { v -> try { JSONObject(v).optLong("at") } catch (e: Exception) { 0L } } ?: 0L }
        .take(all.size - MAX_PENDING + 1).forEach { edit.remove(it.key) }
    }
    edit.apply()
    return token
  }

  /** A button's job, once (then it is gone, with the other buttons' jobs of the same notification): null if unknown,
   *  already used or older than a day. */
  @Synchronized
  private fun take(context: Context, token: String?): JSONObject? {
    if (token == null) return null
    val prefs = context.getSharedPreferences(PENDING, Context.MODE_PRIVATE)
    val raw = prefs.getString(token, null) ?: return null
    val job = try { JSONObject(raw) } catch (e: Exception) { null }
    val edit = prefs.edit().remove(token)
    if (job != null) {
      val id = job.optInt("id", -1)
      for ((k, v) in prefs.all) {
        val other = (v as? String)?.let { try { JSONObject(it) } catch (e: Exception) { null } }
        if (other == null || other.optInt("id", -2) == id) edit.remove(k)
      }
    }
    edit.commit()
    if (job == null || System.currentTimeMillis() - job.optLong("at") > MAX_AGE_MS) return null
    return job
  }

  /** Done in the background by [NoteReceiver]. */
  internal fun run(context: Context, intent: Intent) {
    val job = take(context, intent.getStringExtra(EXTRA_TOKEN)) ?: return
    val id = job.optInt("id")
    val note = job.optString("note", "{}")
    val action = job.optString("action")
    val title = job.optString("title", "Orb")
    val group = job.optString("group", "")
    val words = job.optJSONObject("words") ?: JSONObject()
    val call = job.optJSONObject("call") ?: return
    // Before Android 12 a button does not ask to unlock: with the phone locked nothing is done (a tap, after unlocking,
    // opens the chat).
    val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (keyguard?.isDeviceLocked == true) {
      say(context, id, title, words.optString("locked", "…"), note, group, gone = false)
      return
    }
    val params = call.optJSONObject("params") ?: JSONObject()
    val textParam = call.optString("text", "")
    if (textParam.isNotEmpty()) {
      val typed = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString()?.trim().orEmpty()
      if (typed.isEmpty()) {
        // Nothing typed: the message stays (without its buttons; a tap opens the chat).
        say(context, id, title, job.optString("body"), note, group, gone = false)
        return
      }
      params.put(textParam, typed)
    }
    // While it goes: the buttons go away (a reply also stops Android's spinner).
    say(context, id, title, words.optString("sending", "…"), note, group, gone = false)
    try {
      PcCall.call(context, call.getString("method"), params)
      val done = when (action) { "reply" -> "sent"; "allow" -> "allowed"; else -> "denied" }
      say(context, id, title, words.optString(done, "✓"), note, group, gone = true)
    } catch (e: Exception) {
      val why = (e as? PcCall.Failed)?.message ?: e.toString()
      val text = words.optString("failed", "{error}").replace("{error}", words.optString("err_$why", why))
      say(context, id, title, text, note, group, gone = false)
    }
    OrbNativePlugin.noteDone(note)
  }
}

/** A notification's button answered without opening the app (exported: no; only Orb's own PendingIntents reach it, and
 *  only with the phone unlocked: Notes.show, Notes.run). */
class NoteReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val result = goAsync()
    Thread {
      try {
        Notes.run(context.applicationContext, intent)
      } finally {
        result.finish()
      }
    }.start()
  }
}
