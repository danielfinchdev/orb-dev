package dev.orb.app.ui.projects

import dev.orb.app.LinkRuntime
import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.ui.chats.ChatsBackend
import dev.orb.app.ui.tasks.TasksParser
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
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

    /** The list as last saved on the phone; shown first and while the PC cannot be reached. */
    fun saved(): kotlinx.coroutines.flow.Flow<ProjectsData> = kotlinx.coroutines.flow.emptyFlow()

    /** The listed projects with their icons, and the finished ones when the PC can list them. */
    suspend fun list(): Result<ProjectsData>

    /** [category] and [notes] are optional; the PC picks the folder when there is no category. */
    suspend fun create(name: String, category: String?, notes: String): Result<Unit>

    /** A null [name] clears the active project. */
    suspend fun setActive(name: String?): Result<Unit>
    suspend fun reopen(key: String): Result<Unit>

    /** The chats and tasks of one project and what git says about its folder. */
    suspend fun detail(name: String): Result<ProjectDetailData>

    /** `projects.review` / `projects.securityReview`: both create a read-only task and answer its id when the PC says it. */
    suspend fun review(name: String): Result<Long?>
    suspend fun securityReview(name: String): Result<Long?>

    /** `projects.finish`: the project leaves the list and moves to «Terminados». */
    suspend fun finish(name: String): Result<Unit>

    /** The project's logbook as the PC returns it: the latest entries as plain text. */
    suspend fun log(name: String): Result<String>

    /** The open pull requests; the PC answers with its own message when `gh` or its sign-in is missing. */
    suspend fun prs(name: String): Result<List<PrRow>>
    suspend fun pr(name: String, number: Int): Result<PrDetail>

    /** Merges as the PC's own GitHub account; [confirmed] exists only after the person accepted the dialog for this pull request. */
    suspend fun mergePr(name: String, number: Int, method: String, headRefOid: String, confirmed: Confirmed): Result<Unit>
}

class RuntimeProjectsBackend(
    private val runtime: LinkRuntime,
    private val chats: ChatsBackend? = null,
    private val container: dev.orb.app.AppContainer? = null,
) : ProjectsBackend {
    private val api get() = runtime.api
    override val connection get() = runtime.client.connection
    override val events get() = runtime.client.events

    override fun available(m: ApiMethod) = api.available(m)

    private fun Result<JsonElement>.unit(): Result<Unit> = map { }

    private companion object {
        const val SNAP_LIST = "projects.list"
        const val SNAP_ICONS = "projects.icons"
        const val SNAP_FINISHED = "projects.finished"
    }

    override fun saved(): kotlinx.coroutines.flow.Flow<ProjectsData> = kotlinx.coroutines.flow.flow {
        // The database opens in the background; until then there is nothing to show.
        val dao = container?.cacheDao() ?: return@flow
        emitAll(
            kotlinx.coroutines.flow.combine(dao.observeSnapshot(SNAP_LIST), dao.observeSnapshot(SNAP_ICONS), dao.observeSnapshot(SNAP_FINISHED)) { list, icons, finished ->
                fun parse(json: String?) = json?.let { runCatching { kotlinx.serialization.json.Json.parseToJsonElement(it) }.getOrNull() }
                val rows = parse(list?.json) as? JsonArray ?: return@combine ProjectsData.Empty
                ProjectsData(ProjectsParser.list(rows, parse(icons?.json)), ProjectsParser.finished(parse(finished?.json)))
            },
        )
    }

    override suspend fun list(): Result<ProjectsData> = coroutineScope {
        val list = async { api.projects.list() }
        val icons = async { if (api.available(ApiMethods.PROJECTS_ICONS)) api.projects.icons().getOrNull() else null }
        val finished = async { if (api.available(ApiMethods.PROJECTS_FINISHED)) api.projects.finished().getOrNull() else null }
        val answer = list.await().getOrElse { return@coroutineScope Result.failure(it) }
        if (answer !is JsonArray) return@coroutineScope Result.failure(LinkException(LinkError.BadAnswer))
        val iconsAnswer = icons.await()
        val finishedAnswer = finished.await()
        container?.cacheSync()?.let { sync ->
            sync.applySnapshot(SNAP_LIST, answer)
            if (iconsAnswer != null) sync.applySnapshot(SNAP_ICONS, iconsAnswer)
            if (finishedAnswer != null) sync.applySnapshot(SNAP_FINISHED, finishedAnswer)
        }
        Result.success(ProjectsData(ProjectsParser.list(answer, iconsAnswer), ProjectsParser.finished(finishedAnswer)))
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

    override suspend fun detail(name: String): Result<ProjectDetailData> = coroutineScope {
        val tasks = async { api.tasks.list() }
        val info = async { if (api.available(ApiMethods.PROJECTS_INFO)) api.projects.info(byName(name)).getOrNull() else null }
        val branch = async { if (api.available(ApiMethods.PROJECTS_BRANCH)) api.projects.branch(byName(name)).getOrNull() else null }
        val rows = tasks.await().getOrElse { return@coroutineScope Result.failure(it) }
        if (rows !is JsonArray) return@coroutineScope Result.failure(LinkException(LinkError.BadAnswer))
        val mine = TasksParser.list(rows).filter { it.project.equals(name, ignoreCase = true) }
        val inbox = chats?.inbox()?.firstOrNull()?.rows.orEmpty().filter { it.project.equals(name, ignoreCase = true) }
        val git = ProjectInfoParser.info(info.await()) ?: ProjectInfoParser.branch(branch.await())
        Result.success(ProjectDetailData(inbox, mine, git))
    }

    private fun byName(name: String) = buildJsonObject { put("name", name) }

    override suspend fun review(name: String) = api.projects.review(byName(name)).map { ProjectInfoParser.taskId(it) }
    override suspend fun securityReview(name: String) = api.projects.securityReview(byName(name)).map { ProjectInfoParser.taskId(it) }
    override suspend fun finish(name: String) = api.projects.finish(byName(name)).unit()

    override suspend fun log(name: String): Result<String> =
        api.logs.read(buildJsonObject { put("project", name) }).mapCatching { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: throw LinkException(LinkError.BadAnswer) }

    override suspend fun prs(name: String): Result<List<PrRow>> = api.projectsPrs(name).mapCatching {
        if (it !is JsonArray) throw LinkException(LinkError.BadAnswer)
        PrParser.list(it)
    }

    override suspend fun pr(name: String, number: Int): Result<PrDetail> =
        api.projectsPr(name, number).mapCatching { PrParser.detail(it) ?: throw LinkException(LinkError.BadAnswer) }

    override suspend fun mergePr(name: String, number: Int, method: String, headRefOid: String, confirmed: Confirmed): Result<Unit> =
        api.projectsMergePr(name, number, method, headRefOid, confirmed).unit()
}
