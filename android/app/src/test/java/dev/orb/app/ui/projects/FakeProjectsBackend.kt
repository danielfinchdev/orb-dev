package dev.orb.app.ui.projects

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

fun project(name: String, category: String? = "web", active: Boolean = false, open: Int = 0, icon: String? = null) =
    ProjectItem(name, category, active, open, icon)

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

    override fun available(m: ApiMethod) = m.name !in unavailable

    override suspend fun list(): Result<ProjectsData> { listCount++; return listResult ?: Result.success(data) }

    private suspend fun act(name: String): Result<Unit> {
        calls += name
        gate?.await()
        return actionResult
    }

    override suspend fun create(name: String, category: String?, notes: String) = act("create $name|$category|$notes")
    override suspend fun setActive(name: String?) = act("active $name")
    override suspend fun reopen(key: String) = act("reopen $key")

    var detailResult: Result<ProjectDetailData> = Result.success(ProjectDetailData(emptyList(), emptyList(), null))
    var logResult: Result<String> = Result.success("")

    override suspend fun detail(name: String) = detailResult
    override suspend fun review(name: String): Result<Long?> = act("review $name").map { 41L }
    override suspend fun securityReview(name: String): Result<Long?> = act("security $name").map { null }
    override suspend fun finish(name: String) = act("finish $name")
    override suspend fun log(name: String): Result<String> { calls += "log $name"; return logResult }
}
