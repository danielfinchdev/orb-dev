package dev.orb.app.ui.chats

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.api.OrbApi
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.kit.OrbCard
import dev.orb.app.ui.kit.OrbKit
import dev.orb.app.ui.kit.ProjectDot
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.Normalizer

// ---------- @mentions ----------

enum class MentionKind { Task, Conversation, Log }

/** One thing the PC offers to attach to a message with «@». [token] is what goes into the text and the PC expands on arrival. */
class MentionOption(val token: String, val label: String, val hint: String?, val kind: MentionKind) {
    /** The project a log belongs to (its dot is drawn); null for the general log and for everything else. */
    val project: String? get() = if (kind == MentionKind.Log) token.substringAfter(':').takeIf { it != "general" } else null
}

/** Where the «@» list comes from. Null means the PC cannot say (no link, an older PC), and the list does not show. */
fun interface MentionSource {
    suspend fun options(): List<MentionOption>?
}

/** `mentions.options` of the PC: a list of {token, label, hint, kind}. Read leniently: what does not fit is left out. */
object MentionParser {
    // The tokens the PC knows how to expand (src/engine/mentions.mjs); anything else would reach the agent as plain text.
    private val TOKEN = Regex("^@(tarea|conversacion|bitacora):[\\w.-]{1,64}$")
    private val ABSOLUTE = Regex("^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/)")

    fun parse(raw: JsonElement?): List<MentionOption> {
        val rows = raw as? JsonArray ?: return emptyList()
        val seen = HashSet<String>()
        return rows.mapNotNull { row ->
            val o = row as? JsonObject ?: return@mapNotNull null
            val token = o.text("token")?.trim() ?: return@mapNotNull null
            val match = TOKEN.matchEntire(token) ?: return@mapNotNull null
            val label = o.text("label")?.let(::noPath)?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            if (!seen.add(token)) return@mapNotNull null
            val kind = when (match.groupValues[1]) { "tarea" -> MentionKind.Task; "conversacion" -> MentionKind.Conversation; else -> MentionKind.Log }
            MentionOption(token, label, o.text("hint")?.let(::noPath)?.takeIf { it.isNotBlank() }, kind)
        }
    }

    private fun JsonObject.text(key: String) = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /** The PC's own folders are never shown: a path becomes its last segment. */
    internal fun noPath(text: String): String {
        val t = text.trim()
        return if (ABSOLUTE.containsMatchIn(t)) t.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\') else t
    }
}

/** The `mentions.options` of the linked PC. */
class RuntimeMentionSource(private val api: OrbApi) : MentionSource {
    override suspend fun options(): List<MentionOption>? {
        if (!api.available(ApiMethods.MENTIONS_OPTIONS)) return null
        return api.mentions.options().getOrNull()?.let(MentionParser::parse)
    }
}

/** The «@» being typed at the cursor: [start] is the index of the «@», [query] what follows it. */
class MentionTrigger(val start: Int, val query: String) {
    companion object {
        private val AT = Regex("(?:^|\\s)@([^\\s@]{0,40})$")

        fun at(text: String, cursor: Int): MentionTrigger? {
            if (cursor < 0 || cursor > text.length) return null
            val m = AT.find(text.substring(0, cursor)) ?: return null
            val group = m.groups[1] ?: return null
            return MentionTrigger(group.range.first - 1, group.value)
        }
    }
}

object MentionFilter {
    private const val PER_KIND = 8

    fun filter(all: List<MentionOption>, query: String): List<MentionOption> {
        val q = fold(query)
        val hits = all.filter { q.isEmpty() || fold(it.label).contains(q) || fold(it.hint.orEmpty()).contains(q) }
        // What starts with the query first, then the order the PC gave; each kind is capped so tasks never bury the logs.
        return MentionKind.entries.flatMap { kind -> hits.filter { it.kind == kind }.sortedBy { if (fold(it.label).removePrefix("#").startsWith(q)) 0 else 1 }.take(PER_KIND) }
    }

    private fun fold(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
}

// ---------- «/» commands ----------

/** A command of the box. [run] does it; the box empties first, so a command never ends up sent as a message. */
class ComposerCommand(val name: String, val description: String, val icon: ImageVector, val run: () -> Unit)

object CommandTrigger {
    private val SLASH = Regex("^/([^\\s/]*)$")

    /** The part after the «/» when the whole text is a command being typed; null otherwise. */
    fun query(text: String): String? = SLASH.matchEntire(text)?.groupValues?.get(1)

    fun filter(all: List<ComposerCommand>, query: String): List<ComposerCommand> =
        all.filter { it.name.removePrefix("/").startsWith(query, ignoreCase = true) }
}

// ---------- The lists above the box ----------

/** `.lcard` with an `.mgrp` heading and `.mrow` rows (56 dp): what appears over the writing box while «@» or «/» is typed. */
@Composable
internal fun SuggestionCard(title: String, icon: ImageVector, count: Int, modifier: Modifier = Modifier, rows: @Composable () -> Unit) {
    OrbCard(modifier.padding(start = 10.dp, end = 10.dp, bottom = 8.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 6.dp)
                .semantics(mergeDescendants = true) {
                    heading()
                    // A screen reader says what opened and how many rows it has, and again when the filter changes it.
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = ChatTexts.suggestionCount(title, count)
                },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(icon, null, Modifier.size(14.dp), tint = OrbKit.mutedForeground)
            Text(title, color = OrbKit.foreground, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium)
        }
        Column(
            Modifier.heightIn(max = 224.dp).verticalScroll(rememberScrollState()).semantics { collectionInfo = CollectionInfo(count, 1) },
        ) { rows() }
    }
}

@Composable
internal fun SuggestionRow(title: String, sub: String?, onClick: () -> Unit, lead: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(20.dp), horizontalAlignment = Alignment.CenterHorizontally) { lead() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, color = OrbKit.foreground, fontSize = 15.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!sub.isNullOrBlank()) Text(sub, color = OrbKit.mutedForeground, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
internal fun MentionList(options: List<MentionOption>, onPick: (MentionOption) -> Unit, modifier: Modifier = Modifier) {
    SuggestionCard(ChatTexts.MENTION_TITLE, OrbIcons.AtSign, options.size, modifier) {
        for (o in options) {
            SuggestionRow(o.label, o.hint, { onPick(o) }) {
                val project = o.project
                if (project != null) ProjectDot(project)
                else Icon(
                    when (o.kind) { MentionKind.Task -> OrbIcons.Tasks; MentionKind.Conversation -> OrbIcons.Chat; MentionKind.Log -> OrbIcons.FileText },
                    null, Modifier.size(16.dp), tint = OrbKit.mutedForeground,
                )
            }
        }
    }
}

@Composable
internal fun CommandList(commands: List<ComposerCommand>, onPick: (ComposerCommand) -> Unit, modifier: Modifier = Modifier) {
    SuggestionCard(ChatTexts.COMMANDS_TITLE, OrbIcons.Slash, commands.size, modifier) {
        for (c in commands) SuggestionRow(c.name, c.description, { onPick(c) }) { Icon(c.icon, null, Modifier.size(16.dp), tint = OrbKit.mutedForeground) }
    }
}

// ---------- Dictation ----------

/** The system's speech recognizer, if the phone has one. The app asks for no microphone permission: the system screen listens. */
class Dictation(val available: Boolean, val start: () -> Unit)

internal fun recognizerIntent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)

/** [onText] gets the recognized phrase; it is put in the box, never sent. */
@Composable
internal fun rememberDictation(onText: (String) -> Unit): Dictation {
    val context = LocalContext.current
    val latest = rememberUpdatedState(onText)
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val phrase = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
            if (!phrase.isNullOrEmpty()) latest.value(phrase)
        }
    }
    val intent = remember { recognizerIntent() }
    val available = remember(context) { intent.resolveActivity(context.packageManager) != null }
    return remember(available, launcher) {
        Dictation(available) {
            // The recognizer can disappear between the check and the tap (an app removed); nothing to say then.
            try { launcher.launch(intent) } catch (_: ActivityNotFoundException) { }
        }
    }
}
