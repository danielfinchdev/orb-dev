package dev.orb.app.ui.chats

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * What the person is answering from the writing box: which question of the thread it belongs to, whether they chose to
 * write their own answer and, for a question that takes several, the options picked so far. The cards write into it and the
 * box reads it, so a question is answered from one place whichever of the two the person used.
 */
class AnswerDraft {
    var question by mutableStateOf<Long?>(null)
        private set
    var typing by mutableStateOf(false)
    val picked = mutableStateListOf<String>()

    /** The box sends an answer instead of a message: the person asked to write one or picked an option of a question that takes several. */
    val active: Boolean get() = question != null && (typing || picked.isNotEmpty())

    /** Makes [id] the question being answered; whatever was chosen for another one is dropped. */
    fun take(id: Long) {
        if (question != id) { reset(); question = id }
    }

    fun reset() {
        question = null
        typing = false
        picked.clear()
    }
}
