package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.ui.linkErrorText
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** How far the reading of what the PC offers has got. */
enum class OptionsStatus { Loading, Ready, Failed, Unsupported }

/**
 * What the person chose for an Orbe chat. Nothing exists on the PC yet: the chat is created with the first message, with
 * exactly these choices (a null [project] with [setProject] is «Sin proyecto»; without it the PC uses its active one).
 */
@Immutable
data class OrbeDraft(val setProject: Boolean, val project: String?, val brain: Brain?)

/** Where «Empezar» leads. */
sealed interface NewChatOutcome {
    /** A direct chat the PC has already created. */
    data class Session(val id: String) : NewChatOutcome

    /** An Orbe chat that is created when the first message is sent. */
    data class Draft(val draft: OrbeDraft) : NewChatOutcome
}

/** The small dialog that creates a project from the sheet. */
@Immutable
data class NewProjectUi(val saving: Boolean = false, val error: String? = null)

@Immutable
data class NewChatState(
    val options: NewChatOptions = NewChatOptions.Empty,
    val optionsStatus: OptionsStatus = OptionsStatus.Loading,
    /** True for a direct chat with an agent; false for Orbe. */
    val direct: Boolean = false,
    /** The agent of a direct chat; null until the PC says which ones it can run. */
    val agent: String? = null,
    /** The project the chat starts in (the PC's active one until the person picks); null = «Sin proyecto». */
    val project: String? = null,
    val brainAgent: String? = null,
    val model: String? = null,
    val effort: String? = null,
    val starting: Boolean = false,
    val online: Boolean = false,
    val canCreateProject: Boolean = false,
    val newProject: NewProjectUi? = null,
) {
    /** A direct chat needs the agent the PC can run; Orbe needs nothing more than the link. */
    val canStart get() = online && !starting && (!direct || agentOption != null)

    /** The agent whose models the brain row offers: the chosen one in a direct chat, the brain's in an Orbe chat. */
    val brainOwner get() = if (direct) agent else brainAgent
    val agentOption get() = options.agents.firstOrNull { it.id == brainOwner }
    val modelOption get() = agentOption?.models?.firstOrNull { it.id == model }

    /** Short label of the chosen brain/model; null while the PC's own choice stands. */
    val brainLabel get() = agentOption?.let { a ->
        listOfNotNull(a.label, modelOption?.label?.takeIf { model != null }, effort?.let(::reasoningText)).joinToString(" · ")
    }
}

/**
 * Starts a chat on the PC. Nothing runs on the phone. A direct chat is created right away (`sessions.create`) and the
 * sheet leaves; an Orbe chat is only a draft the chat screen opens, so leaving it empty leaves nothing on the PC.
 */
class NewChatViewModel(private val backend: NewChatBackend) : ViewModel() {
    private val _state = MutableStateFlow(NewChatState(canCreateProject = backend.available(ApiMethods.PROJECTS_CREATE)))
    val state: StateFlow<NewChatState> = _state

    private val _outcome = Channel<NewChatOutcome>(Channel.BUFFERED)
    val outcome = _outcome.receiveAsFlow()
    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private var projectTouched = false
    private var inFlight = false

    init {
        viewModelScope.launch {
            backend.connection.map { it is ConnectionState.Online }.distinctUntilChanged().collect { online ->
                _state.update { it.copy(online = online) }
                if (online && _state.value.optionsStatus.let { it != OptionsStatus.Ready && it != OptionsStatus.Unsupported }) loadOptions()
            }
        }
    }

    fun reload() {
        viewModelScope.launch { loadOptions() }
    }

    private suspend fun loadOptions() {
        if (!backend.available(ApiMethods.MODELS_CATALOG)) {
            _state.update { it.copy(optionsStatus = OptionsStatus.Unsupported) }
            return
        }
        _state.update { it.copy(optionsStatus = OptionsStatus.Loading) }
        backend.options().fold(
            onSuccess = { o ->
                _state.update { s ->
                    // «Directo» chosen before the PC answered gets the first agent it can run.
                    val agent = if (s.direct && o.agents.none { it.id == s.agent }) o.agents.firstOrNull()?.id else s.agent
                    s.copy(options = o, optionsStatus = OptionsStatus.Ready, agent = agent, project = if (projectTouched) s.project else o.activeProject)
                }
            },
            onFailure = { _state.update { s -> s.copy(optionsStatus = OptionsStatus.Failed) } },
        )
    }

    fun selectOrbe() {
        if (!_state.value.direct) return
        _state.update { it.copy(direct = false, brainAgent = null, model = null, effort = null) }
    }

    fun selectDirect() {
        if (_state.value.direct) return
        _state.update { it.copy(direct = true, agent = it.options.agents.firstOrNull()?.id, brainAgent = null, model = null, effort = null) }
    }

    fun selectAgent(id: String) {
        if (_state.value.agent == id && _state.value.direct) return
        _state.update { it.copy(direct = true, agent = id, brainAgent = null, model = null, effort = null) }
    }

    /** [agent] is the brain's agent for an Orbe chat; a direct chat keeps its own. A null [model] is the agent's default. */
    fun pickBrain(agent: String?, model: String?, effort: String?) {
        _state.update { s ->
            if (s.direct) s.copy(model = model?.ifEmpty { null }, effort = effort)
            else s.copy(brainAgent = agent, model = model?.ifEmpty { null }, effort = effort)
        }
    }

    fun clearBrain() {
        _state.update { it.copy(brainAgent = null, model = null, effort = null) }
    }

    fun pickProject(name: String?) {
        projectTouched = true
        _state.update { it.copy(project = name) }
    }

    // --- «Nuevo» project ---

    fun openNewProject() {
        if (_state.value.canCreateProject) _state.update { it.copy(newProject = NewProjectUi()) }
    }

    fun closeNewProject() {
        if (_state.value.newProject?.saving == true) return
        _state.update { it.copy(newProject = null) }
    }

    /** The same rules as the Projects screen: a name is needed and the PC must be there; the PC's refusal is told as is. */
    fun createProject(name: String) {
        val n = _state.value.newProject ?: return
        val clean = name.trim()
        if (n.saving || clean.isEmpty()) return
        if (!_state.value.online) {
            _state.update { it.copy(newProject = n.copy(error = ChatTexts.NEW_CHAT_PROJECT_OFFLINE)) }
            return
        }
        _state.update { it.copy(newProject = n.copy(saving = true, error = null)) }
        viewModelScope.launch {
            backend.createProject(clean).fold(
                onSuccess = {
                    // Read the PC's list again so the new project comes with whatever the PC made of it, and choose it.
                    backend.options().onSuccess { o -> _state.update { s -> s.copy(options = o, optionsStatus = OptionsStatus.Ready) } }
                    projectTouched = true
                    _state.update { s ->
                        val known = s.options.projects.any { it.name == clean }
                        val options = if (known) s.options else s.options.copy(projects = s.options.projects + ProjectOption(clean, false))
                        s.copy(options = options, project = clean, newProject = null)
                    }
                },
                onFailure = { e -> _state.update { it.copy(newProject = it.newProject?.copy(saving = false, error = linkErrorText(e))) } },
            )
        }
    }

    // --- «Empezar» ---

    /** One tap = one request: while one is on its way the others are ignored. */
    fun start() {
        val s = _state.value
        if (inFlight || !s.canStart) return
        if (!s.direct) {
            val brain = s.brainAgent?.let { Brain(it, s.model, s.effort) }
            _outcome.trySend(NewChatOutcome.Draft(OrbeDraft(projectTouched, s.project, brain)))
            return
        }
        inFlight = true
        _state.update { it.copy(starting = true) }
        viewModelScope.launch {
            backend.createAgent(s.agent ?: return@launch, s.project, s.model, s.effort).fold(
                onSuccess = { _outcome.trySend(NewChatOutcome.Session(it)) },
                onFailure = { _messages.trySend("${ChatTexts.NEW_CHAT_FAILED}. ${linkErrorText(it)}") },
            )
            inFlight = false
            _state.update { it.copy(starting = false) }
        }
    }
}

/** «razonamiento alto»: how the mockup names a reasoning level next to a model. */
fun reasoningText(level: String) = "razonamiento ${BrainInfo.reasoningWord(level)}"
