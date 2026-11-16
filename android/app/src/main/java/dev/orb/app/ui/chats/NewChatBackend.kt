package dev.orb.app.ui.chats

import androidx.compose.runtime.Immutable
import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Immutable
data class ModelOption(val id: String, val label: String, val recommended: Boolean, val efforts: List<String>)

@Immutable
data class AgentOption(val id: String, val label: String, val defaultModel: String?, val models: List<ModelOption>)

@Immutable
data class ProjectOption(val name: String, val active: Boolean)

/** What the PC offers for a new chat: the agents it can run now, its projects and the one it has active. */
@Immutable
data class NewChatOptions(val agents: List<AgentOption>, val projects: List<ProjectOption>, val activeProject: String?) {
    companion object {
        val Empty = NewChatOptions(emptyList(), emptyList(), null)
    }
}

/** The assistant's brain for a new Orbe chat; only what the person picked is sent. */
@Immutable
data class Brain(val agent: String, val model: String?, val reasoning: String?)

/** What the new-chat screen needs from the PC. Both chats are created there; the phone only asks. */
interface NewChatBackend {
    val connection: StateFlow<ConnectionState>
    fun available(m: ApiMethod): Boolean

    suspend fun options(): Result<NewChatOptions>

    /**
     * `chat.send` without a conversation. [project] null with [setProject] = "Sin proyecto"; without [setProject] the
     * PC uses its active project. → the new conversation's id.
     */
    suspend fun createOrbe(text: String, setProject: Boolean, project: String?, brain: Brain?, clientId: String): Result<Long>

    /** `sessions.create` → the session id. Without a project the PC only allows the read-only permission. */
    suspend fun createAgent(agent: String, project: String?, model: String?, reasoning: String?): Result<String>

    /** `sessions.send` for the first line of a direct chat. */
    suspend fun sendFirst(session: String, text: String, clientId: String): Result<Unit>
}

class RuntimeNewChatBackend(private val runtime: LinkRuntime) : NewChatBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override fun available(m: ApiMethod) = api.available(m)

    override suspend fun options(): Result<NewChatOptions> = coroutineScope {
        val state = async { api.app.state() }
        val catalog = async { api.models.catalog() }
        val projects = async { api.projects.list() }
        val cat = catalog.await().getOrElse { return@coroutineScope Result.failure(it) }
        // The projects and the state only complete the choice; without them the chat still starts in the PC's default.
        Result.success(NewChatParser.parse(cat, state.await().getOrNull(), projects.await().getOrNull()))
    }

    override suspend fun createOrbe(text: String, setProject: Boolean, project: String?, brain: Brain?, clientId: String): Result<Long> =
        api.chatSend(NewChatParams.orbe(text, setProject, project, brain), clientId).mapCatching { r -> (r as? JsonObject)?.long("conversation") ?: throw LinkException(LinkError.BadAnswer) }

    override suspend fun createAgent(agent: String, project: String?, model: String?, reasoning: String?): Result<String> =
        api.sessions.create(NewChatParams.session(agent, project, model, reasoning)).mapCatching { r -> (r as? JsonObject)?.str("id") ?: throw LinkException(LinkError.BadAnswer) }

    override suspend fun sendFirst(session: String, text: String, clientId: String): Result<Unit> =
        api.sessionsSend(buildJsonObject { put("id", session); put("text", text) }, clientId).map { }
}

/** The bodies of the two requests that start a chat; apart from the transport so the rules can be tested. */
object NewChatParams {
    /** No `conversation` (that opens a new one); `project` only when the person chose, `brain` only when changed. */
    fun orbe(text: String, setProject: Boolean, project: String?, brain: Brain?) = buildJsonObject {
        put("text", text)
        if (setProject) put("project", project?.let { JsonPrimitive(it) } ?: JsonNull)
        if (brain != null) put(
            "brain",
            buildJsonObject {
                put("agent", brain.agent)
                brain.model?.let { put("model", it) }
                brain.reasoning?.let { put("reasoning", it) }
            },
        )
    }

    /** Without a project the PC only allows the read-only level; with one it keeps its own default. «total» is never asked for. */
    fun session(agent: String, project: String?, model: String?, reasoning: String?) = buildJsonObject {
        put("agent", agent)
        if (project != null) put("project", project)
        model?.let { put("model", it) }
        reasoning?.let { put("reasoning", it) }
        if (project == null) put("permission", "leer")
    }
}

object NewChatParser {
    fun parse(catalog: JsonElement, appState: JsonElement?, projects: JsonElement?): NewChatOptions {
        val state = appState as? JsonObject
        // null = the PC does not limit the agents; a list = only those can run now.
        val allowed = (state?.get("agentsAvailable") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }?.toSet()
        val agents = (catalog as? JsonArray).orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val id = o.str("id") ?: return@mapNotNull null
            if (allowed != null && id !in allowed) return@mapNotNull null
            val models = (o["models"] as? JsonArray).orEmpty().mapNotNull { m ->
                val mo = m as? JsonObject ?: return@mapNotNull null
                ModelOption(
                    id = mo.str("id") ?: "", label = mo.str("label") ?: mo.str("id") ?: return@mapNotNull null,
                    recommended = (mo["recommended"] as? JsonPrimitive)?.booleanOrNull == true,
                    efforts = (mo["efforts"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content },
                )
            }
            AgentOption(id, o.str("label") ?: agentName(id) ?: id, o.str("defaultModel"), models)
        }
        val active = ((state?.get("activeProject") as? JsonObject)?.str("name"))
        val list = (projects as? JsonArray).orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            val name = o.str("name") ?: return@mapNotNull null
            ProjectOption(name, o.str("active") == "true" || (o["active"] as? JsonPrimitive)?.booleanOrNull == true || name == active)
        }
        return NewChatOptions(agents, list, active ?: list.firstOrNull { it.active }?.name)
    }
}
