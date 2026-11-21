package dev.orb.app.ui.projects

import androidx.compose.runtime.Immutable
import dev.orb.app.ui.chats.bool
import dev.orb.app.ui.chats.int
import dev.orb.app.ui.chats.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** The folders Orb sorts projects into; `multi` is a project with a folder per platform. */
val ProjectCategories = listOf("windows", "linux", "ios", "android", "web", "multi")

/** The order the new-project sheet offers them in: the mockup's own two first, then the rest. */
val NewProjectCategories = listOf("web", "android", "windows", "linux", "ios", "multi")

@Immutable
data class ProjectItem(
    val name: String,
    val category: String?,
    val active: Boolean,
    /** Tasks that are queued, waiting for approval or running. */
    val open: Int,
    /** Of those, the ones waiting for the person's OK; known only while the PC's task list could be read. */
    val approve: Int = 0,
    /** The branch and the number of files git says changed; null for a project without git, without folder or not read yet. */
    val git: ProjectGit? = null,
)

@Immutable
data class FinishedProject(val key: String, val name: String, val category: String?, val at: String?)

@Immutable
data class ProjectsData(val projects: List<ProjectItem>, val finished: List<FinishedProject>) {
    companion object {
        val Empty = ProjectsData(emptyList(), emptyList())
    }
}

object ProjectsParser {
    fun list(el: JsonElement?, approvals: Map<String, Int> = emptyMap()): List<ProjectItem> =
        (el as? JsonArray).orEmpty().mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            val name = o.str("name") ?: return@mapNotNull null
            ProjectItem(name, o.str("category"), o.bool("active"), o.int("open") ?: 0, approvals[name.lowercase()] ?: 0)
        }

    /** `projects.list({withGit:true})`: only the rows that came with `changes` have git data; the rest are left out. */
    fun git(el: JsonElement?): Map<String, ProjectGit> = buildMap {
        for (x in (el as? JsonArray).orEmpty()) {
            val o = x as? JsonObject ?: continue
            val name = o.str("name") ?: continue
            val changes = o.int("changes") ?: continue
            put(name, ProjectGit(o.str("branch")?.takeIf { it.isNotBlank() }, changes, null, null))
        }
    }

    /** How many tasks wait for the person's OK, per project (lower case, like the PC compares names). */
    fun approvals(tasks: List<dev.orb.app.ui.tasks.TaskRow>): Map<String, Int> =
        tasks.filter { it.needsApproval && it.project != null }.groupingBy { it.project!!.lowercase() }.eachCount()

    fun finished(el: JsonElement?): List<FinishedProject> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        FinishedProject(o.str("key") ?: return@mapNotNull null, o.str("name") ?: return@mapNotNull null, o.str("category"), o.str("at"))
    }
}

/** What `projects.info` and `projects.branch` say about the project's repository. */
@Immutable
data class ProjectGit(val branch: String?, val changes: Int?, val ahead: Int?, val remote: String?)

@Immutable
data class ProjectDetailData(
    val chats: List<dev.orb.app.ui.chats.ChatRow>,
    val tasks: List<dev.orb.app.ui.tasks.TaskRow>,
    /** Null when the folder is no git repository or the PC cannot say. */
    val git: ProjectGit?,
    val category: String? = null,
    /** The key to reopen it with, when the project is one of the finished ones (it is then not in the active list). */
    val finishedKey: String? = null,
    val finishedAt: String? = null,
)

object ProjectInfoParser {
    /** `projects.info`: `{git:false}` for a plain folder. */
    fun info(el: JsonElement?): ProjectGit? {
        val o = el as? JsonObject ?: return null
        if (!o.bool("git")) return null
        return ProjectGit(o.str("branch")?.takeIf { it.isNotBlank() }, o.int("changes"), o.int("ahead"), o.str("remote"))
    }

    /** `projects.branch`: the quick answer, used when the full info is not there. */
    fun branch(el: JsonElement?): ProjectGit? {
        val b = (el as? JsonObject)?.str("branch") ?: return null
        return ProjectGit(b, null, null, null)
    }

    /** The task `projects.review` and `projects.securityReview` create. */
    fun taskId(el: JsonElement?): Long? = (el as? JsonObject)?.let { it["id"] as? kotlinx.serialization.json.JsonPrimitive }?.content?.toLongOrNull()
}

@Immutable
data class PrRow(
    val number: Int,
    val title: String,
    val head: String?,
    val base: String?,
    val draft: Boolean,
    val author: String?,
    val updatedAt: String?,
    val reviewDecision: String?,
    val mergeable: String?,
    val headRefOid: String? = null,
)

@Immutable
data class PrCheck(val name: String, val status: String?, val conclusion: String?) {
    /** What the check ended as, or where it is while it has not ended. */
    val outcome get() = (conclusion ?: status).orEmpty().uppercase()
    val passed get() = outcome == "SUCCESS" || outcome == "NEUTRAL" || outcome == "SKIPPED"
    val failed get() = outcome == "FAILURE" || outcome == "ERROR" || outcome == "TIMED_OUT" || outcome == "CANCELLED" || outcome == "ACTION_REQUIRED"
}

@Immutable
data class PrDetail(
    val number: Int,
    val title: String,
    val body: String,
    /** `OPEN`, `MERGED` or `CLOSED`, as GitHub says it. */
    val state: String,
    val head: String?,
    val base: String?,
    val draft: Boolean,
    val author: String?,
    val mergeable: String?,
    val mergeStateStatus: String?,
    val reviewDecision: String?,
    val additions: Int,
    val deletions: Int,
    val changedFiles: Int,
    val checks: List<PrCheck>,
    /** The exact commit the PC showed; a merge is only sent for it, so a branch that moved meanwhile is never merged unseen. */
    val headRefOid: String? = null,
) {
    val open get() = state.equals("OPEN", ignoreCase = true)
    val merged get() = state.equals("MERGED", ignoreCase = true)
    val hasMergeableOid get() = PrParser.isFullOid(headRefOid)
}

object PrParser {
    private val FULL_OID = Regex("[0-9a-fA-F]{40}")

    fun isFullOid(oid: String?) = oid != null && FULL_OID.matches(oid)

    fun list(el: JsonElement?): List<PrRow> = (el as? JsonArray).orEmpty().mapNotNull { x ->
        val o = x as? JsonObject ?: return@mapNotNull null
        PrRow(
            o.int("number") ?: return@mapNotNull null, o.str("title").orEmpty(), o.str("headRefName"), o.str("baseRefName"),
            o.bool("isDraft"), o.str("author"), o.str("updatedAt"), o.str("reviewDecision"), o.str("mergeable"), o.str("headRefOid"),
        )
    }

    fun detail(el: JsonElement?): PrDetail? {
        val o = el as? JsonObject ?: return null
        val checks = (o["checks"] as? JsonArray).orEmpty().mapNotNull { c ->
            val co = c as? JsonObject ?: return@mapNotNull null
            PrCheck(co.str("name").orEmpty(), co.str("status"), co.str("conclusion"))
        }
        return PrDetail(
            number = o.int("number") ?: return null, title = o.str("title").orEmpty(), body = o.str("body").orEmpty(),
            state = o.str("state").orEmpty(), head = o.str("headRefName"), base = o.str("baseRefName"), draft = o.bool("isDraft"),
            author = o.str("author"), mergeable = o.str("mergeable"), mergeStateStatus = o.str("mergeStateStatus"),
            reviewDecision = o.str("reviewDecision"), additions = o.int("additions") ?: 0, deletions = o.int("deletions") ?: 0,
            changedFiles = o.int("changedFiles") ?: 0, checks = checks, headRefOid = o.str("headRefOid"),
        )
    }
}
