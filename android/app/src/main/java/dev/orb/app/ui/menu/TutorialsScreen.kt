package dev.orb.app.ui.menu

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.orb.app.ui.chats.Message
import dev.orb.app.ui.icons.OrbIcons
import dev.orb.app.ui.shell.ScreenBar
import dev.orb.app.ui.theme.OrbTheme
import java.text.Normalizer

/** Which tutorials and questions a search keeps. Accents and case do not matter: «bitacora» finds «Bitácoras». */
object TutorialSearch {
    fun fold(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()

    fun tutorials(query: String, all: List<TutorialTexts.Tutorial> = TutorialTexts.TUTORIALS): List<TutorialTexts.Tutorial> {
        val q = fold(query.trim())
        return if (q.isEmpty()) all else all.filter { t -> fold(TutorialTexts.named(t.title)).contains(q) || t.lines.any { fold(TutorialTexts.named(it)).contains(q) } }
    }

    fun faqs(query: String, all: List<TutorialTexts.Faq> = TutorialTexts.FAQS): List<TutorialTexts.Faq> {
        val q = fold(query.trim())
        return if (q.isEmpty()) all else all.filter { f -> fold(TutorialTexts.named(f.question)).contains(q) || fold(TutorialTexts.named(f.answer)).contains(q) }
    }
}

/** «Tutoriales»: how the app works, in cards that fold, and the frequent questions. Everything is on the phone: no connection needed. */
@Composable
fun TutorialsScreen(onBack: () -> Unit, modifier: Modifier = Modifier) {
    var query by rememberSaveable { mutableStateOf("") }
    // Cards the person opened, by key; a search opens every card it keeps so the match can be seen.
    var open by rememberSaveable { mutableStateOf(setOf<String>()) }
    val searching = query.isNotBlank()
    val tutorials = remember(query) { TutorialSearch.tutorials(query) }
    val faqs = remember(query) { TutorialSearch.faqs(query) }
    fun toggle(key: String) { open = if (key in open) open - key else open + key }

    Column(modifier.fillMaxSize()) {
        ScreenBar(MenuTexts.TUTORIALS, onBack, MenuTexts.BACK)
        OutlinedTextField(
            query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), singleLine = true,
            placeholder = { Text(MenuTexts.TUT_SEARCH) }, leadingIcon = { Icon(OrbIcons.Search, null) },
            trailingIcon = if (searching) {
                { IconButton({ query = "" }) { Icon(OrbIcons.Close, MenuTexts.TUT_CLEAR) } }
            } else null,
        )
        if (tutorials.isEmpty() && faqs.isEmpty()) {
            Message(MenuTexts.tutNoResults(query.trim()))
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (tutorials.isNotEmpty()) {
                item { Heading(MenuTexts.TUT_SECTION_HOW) }
                items(tutorials.size) { i ->
                    val t = tutorials[i]
                    val key = "t:${t.id}"
                    Fold(TutorialTexts.named(t.title), searching || key in open, { toggle(key) }) {
                        t.lines.forEach { Text("•  ${TutorialTexts.named(it)}", style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
            if (faqs.isNotEmpty()) {
                item { Heading(MenuTexts.TUT_SECTION_FAQ) }
                items(faqs.size) { i ->
                    val f = faqs[i]
                    val key = "f:${f.question}"
                    Fold(TutorialTexts.named(f.question), searching || key in open, { toggle(key) }) {
                        Text(TutorialTexts.named(f.answer), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun Heading(text: String) =
    Text(text, Modifier.padding(top = 8.dp, bottom = 2.dp), style = MaterialTheme.typography.labelLarge, color = OrbTheme.colors.text3)

@Composable
private fun Fold(title: String, expanded: Boolean, onToggle: () -> Unit, body: @Composable () -> Unit) {
    Surface(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onToggle).padding(14.dp)
                    .semantics { contentDescription = "$title, ${if (expanded) MenuTexts.TUT_COLLAPSE else MenuTexts.TUT_EXPAND}" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Icon(if (expanded) OrbIcons.ChevronUp else OrbIcons.ChevronDown, null, tint = OrbTheme.colors.text2)
            }
            AnimatedVisibility(expanded) {
                Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { body() }
            }
        }
    }
}
