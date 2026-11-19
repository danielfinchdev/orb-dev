package dev.orb.app.ui.projects

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.Confirmed
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

fun project(name: String, category: String? = "web", active: Boolean = false, open: Int = 0, approve: Int = 0, git: ProjectGit? = null) =
    ProjectItem(name, category, active, open, approve, git)

class FakeProjectsBackend(initial: List<ProjectItem> = emptyList(), finished: List<FinishedProject> = emptyList()) : ProjectsBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    var data = ProjectsData(initial, finished)
    var listResult: Result<ProjectsData>? = null
    var listCount = 0
    var unavailable: Set<String> = emptySet()
    val calls = ArrayList<String>()
    var actionResult: Result<Unit> = Result.success(Unit)
    var gate: CompletableDeferred<Unit>? = null
    val savedFlow = MutableStateFlow(ProjectsData.Empty)
    override fun saved() = savedFlow

    /** What `projects.list({withGit:true})` answers, by project name; an older PC does not read git at all. */
    var gitReadable = true
    var gitResult: Result<Map<String, ProjectGit>> = Result.success(emptyMap())
    var gitGate: CompletableDeferred<Unit>? = null
    var gitCount = 0
    override val readsGit get() = gitReadable

    override suspend fun gitLines(): Result<Map<String, ProjectGit>> {
        gitCount++
        gitGate?.await()
        return gitResult
    }

    override fun available(m: ApiMethod) = m.name !in unavailable

    /** Holds the list back, to look at the loading state. */
    var listGate: CompletableDeferred<Unit>? = null
    var detailGate: CompletableDeferred<Unit>? = null

    override suspend fun list(): Result<ProjectsData> { listCount++; listGate?.await(); return listResult ?: Result.success(data) }

    private suspend fun act(name: String): Result<Unit> {
        calls += name
        gate?.await()
        return actionResult
    }

    override suspend fun create(name: String, category: String?, notes: String) = act("create $name|$category|$notes")
    override suspend fun setActive(name: String?) = act("active $name")
    override suspend fun reopen(key: String) = act("reopen $key")
    override suspend fun createTask(project: String, title: String, description: String) = act("task $project|$title|$description")

    var detailResult: Result<ProjectDetailData> = Result.success(ProjectDetailData(emptyList(), emptyList(), null))
    var logResult: Result<String> = Result.success("")

    override suspend fun detail(name: String): Result<ProjectDetailData> { detailGate?.await(); return detailResult }
    override suspend fun review(name: String): Result<Long?> = act("review $name").map { 41L }
    override suspend fun securityReview(name: String): Result<Long?> = act("security $name").map { null }
    override suspend fun finish(name: String) = act("finish $name")
    override suspend fun log(name: String): Result<String> { calls += "log $name"; return logResult }

    var prList: Result<List<PrRow>> = Result.success(emptyList())
    val prResults = HashMap<Int, Result<PrDetail>>()

    /** What the PC answers to a merge; on success the pull request reads as merged afterwards, like GitHub does. */
    val mergeOids = mutableListOf<String>()
    var mergeResult: Result<Unit> = Result.success(Unit)

    override suspend fun mergePr(name: String, number: Int, method: String, headRefOid: String, confirmed: Confirmed): Result<Unit> {
        calls += "merge $name#$number $method"
        mergeOids += headRefOid
        gate?.await()
        if (mergeResult.isSuccess) prResults[number]?.getOrNull()?.let { prResults[number] = Result.success(it.copy(state = "MERGED")) }
        return mergeResult
    }

    override suspend fun prs(name: String): Result<List<PrRow>> { calls += "prs $name"; return prList }
    override suspend fun pr(name: String, number: Int): Result<PrDetail> {
        calls += "pr $name#$number"
        return prResults[number] ?: Result.failure(LinkException(LinkError.Offline))
    }
}

fun prDetail(number: Int, state: String = "OPEN", draft: Boolean = false, checks: List<PrCheck> = emptyList(), oid: String? = TEST_OID) = PrDetail(
    number, "Arreglar el pie", "Cuerpo", state, "dev", "main", draft, "ana", "MERGEABLE", "CLEAN", null, 10, 2, 3, checks, oid,
)

const val TEST_OID = "0123456789abcdef0123456789abcdef01234567"
