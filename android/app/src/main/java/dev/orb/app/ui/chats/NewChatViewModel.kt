package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

enum class OptionsStatus { Loading, Ready, Failed }

/** The chat that was created; the screen opens it in place of itself. */
data class NewChatCreated(val kind: String, val id: String)

@Immutable
data class NewChatState(
    val options: NewChatOptions = NewChatOptions.Empty,
    val optionsStatus: OptionsStatus = OptionsStatus.Loading,
    /** null = Orbe; otherwise the agent the person talks to directly. */
    val agent: String? = null,
    /** The project the chat starts in (the PC's active one until the person picks); null = «Sin proyecto». */
    val project: String? = null,
    val brainAgent: String? = null,
    val model: String? = null,
    val effort: String? = null,
    val text: String = "",
    val sending: Boolean = false,
    val online: Boolean = false,
) {
    val canCreate get() = online && !sending && text.isNotBlank()
    val agentOption get() = options.agents.firstOrNull { it.id == (agent ?: brainAgent) }
    val modelOption get() = agentOption?.models?.firstOrNull { it.id == model }

    /** Short label of the chosen brain/model; null while the PC's own choice stands. */
    val brainLabel get() = if ((agent ?: brainAgent) == null) null
    else listOfNotNull(agentOption?.label, modelOption?.label?.takeIf { model != null }, effort).joinToString(" · ").ifEmpty { null }
}

/**
 * Starts a chat on the PC. Nothing runs on the phone: the choices travel in one request (Orbe) or two (a direct chat
 * is created, then gets its first line). The text stays in the field when the PC refuses, and a retry reuses what the
 * PC already made, so a lost answer never opens a second chat.
 */
class NewChatViewModel(
    private val backend: NewChatBackend,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) : ViewModel() {
    private val _state = MutableStateFlow(NewChatState())
    val state: StateFlow<NewChatState> = _state

    private val _created = Channel<NewChatCreated>(Channel.BUFFERED)
    val created = _created.receiveAsFlow()
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private var projectTouched = false
    private var inFlight = false

    // What the last attempt already left on the PC, so a retry continues instead of repeating it.
    private var clientId: String? = null
    private var createdSession: String? = null

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().collect { online ->
                _state.update { it.copy(online = online) }
                if (online && _state.value.optionsStatus != OptionsStatus.Ready) loadOptions()
            }
        }
    }

    fun reload() {
        viewModelScope.launch { loadOptions() }
    }

    private suspend fun loadOptions() {
        _state.update { it.copy(optionsStatus = OptionsStatus.Loading) }
        backend.options().fold(
            onSuccess = { o ->
                _state.update { s -> s.copy(options = o, optionsStatus = OptionsStatus.Ready, project = if (projectTouched) s.project else o.activeProject) }
            },
            onFailure = { _state.update { s -> s.copy(optionsStatus = OptionsStatus.Failed) } },
        )
    }

    fun setText(t: String) {
        _state.update { it.copy(text = t) }
        forgetAttempt()
    }

    fun selectOrbe() = select(null)
    fun selectAgent(id: String) = select(id)

    private fun select(agent: String?) {
        if (_state.value.agent == agent) return
        _state.update { it.copy(agent = agent, brainAgent = null, model = null, effort = null) }
        forgetAttempt()
    }

    /** [agent] is the brain's agent for an Orbe chat; a direct chat keeps its own. A null [model] is the agent's default. */
    fun pickBrain(agent: String?, model: String?, effort: String?) {
        _state.update { s ->
            if (s.agent != null) s.copy(model = model?.ifEmpty { null }, effort = effort)
            else s.copy(brainAgent = agent, model = model?.ifEmpty { null }, effort = effort)
        }
        forgetAttempt()
    }

    fun clearBrain() {
        _state.update { it.copy(brainAgent = null, model = null, effort = null) }
        forgetAttempt()
    }

    fun pickProject(name: String?) {
        projectTouched = true
        _state.update { it.copy(project = name) }
        forgetAttempt()
    }

    private fun forgetAttempt() {
        if (inFlight) return
        clientId = null
        createdSession = null
    }

    /** One tap = one request: while one is on its way the others are ignored. */
    fun create() {
        val s = _state.value
        if (inFlight || !s.canCreate) return
        inFlight = true
        _state.update { it.copy(sending = true) }
        val text = s.text.trim()
        viewModelScope.launch {
            val id = clientId ?: newId().also { clientId = it }
            val result = if (s.agent == null) createOrbe(s, text, id) else createDirect(s, s.agent, text, id)
            result.fold(
                onSuccess = { created ->
                    clientId = null
                    createdSession = null
                    _created.trySend(created)
                },
                onFailure = { _messages.trySend("${ChatTexts.NEW_CHAT_FAILED}. ${linkErrorText(it)}") },
            )
            inFlight = false
            _state.update { it.copy(sending = false) }
        }
    }

    private suspend fun createOrbe(s: NewChatState, text: String, clientId: String): Result<NewChatCreated> {
        val brain = s.brainAgent?.let { Brain(it, s.model, s.effort) }
        return backend.createOrbe(text, projectTouched, s.project, brain, clientId).map { NewChatCreated("conversation", it.toString()) }
    }

    private suspend fun createDirect(s: NewChatState, agent: String, text: String, clientId: String): Result<NewChatCreated> {
        val session = createdSession ?: backend.createAgent(agent, s.project, s.model, s.effort)
            .getOrElse { return Result.failure(it) }.also { createdSession = it }
        return backend.sendFirst(session, text, clientId).map { NewChatCreated("session", session) }
    }
}
