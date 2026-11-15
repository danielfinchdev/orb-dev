package dev.orb.app.ui.chats

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow

val sampleOptions = NewChatOptions(
    agents = listOf(
        AgentOption("claude", "Claude Code", "opus", listOf(ModelOption("opus", "Opus", true, listOf("low", "high")), ModelOption("sonnet", "Sonnet", false, emptyList()))),
        AgentOption("codex", "Codex", null, listOf(ModelOption("gpt", "GPT", false, listOf("medium")))),
    ),
    projects = listOf(ProjectOption("tienda-online", true), ProjectOption("api-pagos", false)),
    activeProject = "tienda-online",
)

class FakeNewChatBackend : NewChatBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    override fun available(m: ApiMethod) = true

    var optionsResult: Result<NewChatOptions> = Result.success(sampleOptions)
    var orbeResult: Result<Long> = Result.success(41L)
    var agentResult: Result<String> = Result.success("s9")
    var sendResult: Result<Unit> = Result.success(Unit)

    /** Holds the next create call until completed, to try a second tap while one is on its way. */
    var gate: CompletableDeferred<Unit>? = null
    val calls = ArrayList<String>()
    val clientIds = ArrayList<String>()

    override suspend fun options() = optionsResult

    override suspend fun createOrbe(text: String, setProject: Boolean, project: String?, brain: Brain?, clientId: String): Result<Long> {
        calls += "orbe text=$text setProject=$setProject project=$project brain=${brain?.let { "${it.agent}/${it.model}/${it.reasoning}" }}"
        clientIds += clientId
        gate?.await()
        return orbeResult
    }

    override suspend fun createAgent(agent: String, project: String?, model: String?, reasoning: String?): Result<String> {
        calls += "create agent=$agent project=$project model=$model reasoning=$reasoning"
        gate?.await()
        return agentResult
    }

    override suspend fun sendFirst(session: String, text: String, clientId: String): Result<Unit> {
        calls += "send $session $text"
        clientIds += clientId
        return sendResult
    }
}

fun offline() = Result.failure<Nothing>(LinkException(LinkError.Offline))
