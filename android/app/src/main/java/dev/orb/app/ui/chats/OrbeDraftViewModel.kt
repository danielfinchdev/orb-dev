package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

@Immutable
data class OrbeDraftState(
    val project: String?,
    val online: Boolean = false,
    val connection: ConnectionState = ConnectionState.Connecting,
    /** The brain the first message will be answered with, named as the PC names it; null until it is known. */
    val brain: String? = null,
    /** The first message while it travels to the PC, or after the PC refused it. */
    val pending: PendingMessage? = null,
) {
    val canSend get() = online && pending?.state != PendingState.Sending
}

/**
 * An Orbe chat that does not exist yet. The PC creates the conversation with the first message (`chat.send` needs a text),
 * with the project and the brain chosen in the new-chat sheet; until then nothing is left on the PC or in the list.
 * A refused message stays on the screen to retry or discard, and a retry reuses the same client id so a lost answer
 * never opens a second conversation.
 */
class OrbeDraftViewModel(
    private val backend: NewChatBackend,
    private val draft: OrbeDraft,
    private val newId: () -> String = { UUID.randomUUID().toString() },
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _state = MutableStateFlow(OrbeDraftState(draft.project))
    val state: StateFlow<OrbeDraftState> = _state

    /** The id of the conversation the PC created; the screen opens it in place of the draft. */
    private val _created = Channel<Long>(Channel.BUFFERED)
    val created = _created.receiveAsFlow()

    private var clientId: String? = null

    init {
        viewModelScope.launch {
            backend.connection.collect { c -> _state.update { it.copy(online = c is ConnectionState.Online, connection = c) } }
        }
        viewModelScope.launch {
            // Only names what the PC offers: the chosen brain with the catalog's labels, or the PC's own choice.
            backend.options().onSuccess { o -> _state.update { it.copy(brain = brainLabel(o)) } }
        }
    }

    private fun brainLabel(o: NewChatOptions): String? {
        val b = draft.brain ?: return o.pcBrain?.label
        val agent = o.agents.firstOrNull { it.id == b.agent }
        val model = agent?.models?.firstOrNull { it.id == b.model }?.label
        return BrainInfo(agent?.label, model, b.reasoning).label
    }

    fun send(text: String) {
        val t = text.trim()
        if (t.isEmpty() || !_state.value.canSend) return
        val id = clientId ?: newId().also { clientId = it }
        transmit(PendingMessage(id, t, PendingState.Sending, null, clock()))
    }

    fun retry() {
        val p = _state.value.pending ?: return
        if (!_state.value.canSend) return
        transmit(p.copy(state = PendingState.Sending, error = null))
    }

    /** Gives the message up: the draft is empty again and nothing was created. */
    fun discard() {
        if (_state.value.pending?.state == PendingState.Sending) return
        clientId = null
        _state.update { it.copy(pending = null) }
    }

    private fun transmit(p: PendingMessage) {
        _state.update { it.copy(pending = p) }
        viewModelScope.launch {
            backend.createOrbe(p.text, draft.setProject, draft.project, draft.brain, p.clientId).fold(
                onSuccess = { _created.trySend(it) },
                onFailure = { e -> _state.update { it.copy(pending = p.copy(state = PendingState.Failed, error = linkErrorText(e))) } },
            )
        }
    }
}
