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

@Immutable
data class ProjectItem(
    val name: String,
    val category: String?,
    val active: Boolean,
    /** Tasks that are queued, waiting for approval or running. */
    val open: Int,
    /** A `data:` URL of the project's icon, when it has one. */
    val icon: String?,
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
    fun list(el: JsonElement?, icons: JsonElement?): List<ProjectItem> {
        val iconMap = icons as? JsonObject
        return (el as? JsonArray).orEmpty().mapNotNull { x ->
            val o = x as? JsonObject ?: return@mapNotNull null
            val name = o.str("name") ?: return@mapNotNull null
            ProjectItem(name, o.str("category"), o.bool("active"), o.int("open") ?: 0, iconMap?.str(name)?.takeIf { it.startsWith("data:") })
        }
    }

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
