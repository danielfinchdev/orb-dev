package dev.orb.app.ui.web

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.projects.ProjectsBackend
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The projects the Pizarra can open: the names, and which one is active on the PC. */
data class WhiteboardProjects(val names: List<String>, val active: String?)

/** What the Pizarra needs from the PC. The drawing lives there and nowhere on the phone. */
interface WhiteboardBackend {
    val connection: StateFlow<ConnectionState>
    fun available(m: ApiMethod): Boolean
    suspend fun projects(): Result<WhiteboardProjects>

    /** `whiteboard.load`: `{elements, appState, files, damaged?, …}` of one project. */
    suspend fun load(project: String): Result<JsonObject>

    /** `whiteboard.save`: the drawing and, when there is one, its picture. */
    suspend fun save(project: String, save: WhiteboardMessage.Save): Result<Unit>

    /** `whiteboard.note`: the note of one attachment (the PC adds and removes attachments; the phone only annotates). */
    suspend fun note(project: String, file: String, note: String): Result<Unit>
}

class RuntimeWhiteboardBackend(private val runtime: LinkRuntime, private val projects: ProjectsBackend) : WhiteboardBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection

    override fun available(m: ApiMethod) = api.available(m)

    override suspend fun projects() = projects.list().map { d -> WhiteboardProjects(d.projects.map { it.name }, d.projects.firstOrNull { it.active }?.name) }

    override suspend fun load(project: String) = api.whiteboard.load(buildJsonObject { put("project", project) }).mapCatching {
        it as? JsonObject ?: throw LinkException(LinkError.BadAnswer)
    }

    override suspend fun save(project: String, save: WhiteboardMessage.Save) = api.whiteboard.save(
        buildJsonObject {
            put("project", project)
            put("elements", save.elements)
            put("appState", save.appState)
            put("files", save.files)
            if (save.png != null) put("png", JsonPrimitive(save.png))
        },
    ).map { }

    override suspend fun note(project: String, file: String, note: String) = api.whiteboard.note(
        buildJsonObject { put("project", project); put("file", file); put("note", note) },
    ).map { }

    companion object {
        val NEEDED = listOf(ApiMethods.WHITEBOARD_LOAD, ApiMethods.WHITEBOARD_SAVE)
    }
}
