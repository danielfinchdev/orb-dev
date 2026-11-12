package dev.orb.app.ui.projects

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What the project screens need from the PC. Every action is a request to the PC; nothing runs on the phone.
 * An interface so the view models can be tested without a link.
 */
interface ProjectsBackend {
    val connection: StateFlow<ConnectionState>
    val events: SharedFlow<LinkEvent>

    /** Whether the linked PC can run [m]; what it cannot do is hidden, never shown disabled. */
    fun available(m: ApiMethod): Boolean

    /** The listed projects with their icons, and the finished ones when the PC can list them. */
    suspend fun list(): Result<ProjectsData>

    /** [category] and [notes] are optional; the PC picks the folder when there is no category. */
    suspend fun create(name: String, category: String?, notes: String): Result<Unit>

    /** A null [name] clears the active project. */
    suspend fun setActive(name: String?): Result<Unit>
    suspend fun reopen(key: String): Result<Unit>
}

class RuntimeProjectsBackend(private val runtime: LinkRuntime) : ProjectsBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun Result<JsonElement>.unit(): Result<Unit> = map { }

    override suspend fun list(): Result<ProjectsData> = coroutineScope {
        val list = async { api.projects.list() }
        val icons = async { if (api.available(ApiMethods.PROJECTS_ICONS)) api.projects.icons().getOrNull() else null }
        val finished = async { if (api.available(ApiMethods.PROJECTS_FINISHED)) api.projects.finished().getOrNull() else null }
        val answer = list.await().getOrElse { return@coroutineScope Result.failure(it) }
        if (answer !is JsonArray) return@coroutineScope Result.failure(LinkException(LinkError.BadAnswer))
        Result.success(ProjectsData(ProjectsParser.list(answer, icons.await()), ProjectsParser.finished(finished.await())))
    }

    override suspend fun create(name: String, category: String?, notes: String) = api.projects.create(
        buildJsonObject {
            put("name", name)
            if (category != null) put("category", category)
            if (notes.isNotBlank()) put("notes", notes)
        },
    ).unit()

    override suspend fun setActive(name: String?) = api.projects.setActive(buildJsonObject { put("name", name ?: "") }).unit()
    override suspend fun reopen(key: String) = api.projects.reopen(buildJsonObject { put("key", key) }).unit()
}
