package dev.orb.app.ui.chats

import dev.orb.app.link.api.ApiMethod
import dev.orb.app.link.api.ApiMethods
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkEvent
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonElement

fun row(
    id: String, kind: ChatKind = ChatKind.Orbe, title: String = "Chat $id", project: String? = null, at: String? = "2026-11-11T09:00:00.000Z",
    unread: Int = 0, state: ChatState = ChatState.Idle, pinned: Boolean = false, muted: Boolean = false, section: Long? = null,
    agent: String? = null, lastText: String? = "hola", done: Boolean = false,
) = ChatRow(
    key = "${kind.wire}:$id", kind = kind, id = id, title = title, project = project, lastText = lastText,
    lastFrom = Speaker.Orbe, lastFromName = "Orbe", at = at, unread = unread, state = state, pinned = pinned, pinOrder = null,
    muted = muted, snoozedUntil = null, section = section, agent = agent, done = done, waitingPermission = false, asking = false,
)

class FakeChatsBackend(initial: List<ChatRow> = emptyList(), sections: List<ChatSection> = emptyList()) : ChatsBackend {
    val connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Online("http://pc", "PC", PcVersions(1, 1, "3.8.4")))
    override val connection get() = connectionState
    override val events = MutableSharedFlow<LinkEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val data = MutableStateFlow(InboxData(initial, sections, 0))
    override fun inbox(): Flow<InboxData> = data

    var refreshCount = 0
    var refreshResult: Result<Unit> = Result.success(Unit)
    /** What the PC "has" after a successful action; tests set it to mimic the refreshed cache. */
    var afterAction: (() -> Unit)? = null
    val calls = ArrayList<String>()
    var actionResult: Result<Unit> = Result.success(Unit)
    var trashAvailable = false
    var searchResult: Result<SearchResults> = Result.success(SearchResults.Empty)
    var savedResult = SearchResults.Empty
    val searches = ArrayList<String>()
    var searchGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    var appStateResult: Result<JsonElement> = Result.failure(LinkException(LinkError.Offline))

    override suspend fun refreshInbox(): Result<Unit> { refreshCount++; return refreshResult }
    override suspend fun appState() = appStateResult
    override fun available(m: ApiMethod) = trashAvailable || (m != ApiMethods.CONVERSATIONS_TRASH && m != ApiMethods.SESSIONS_TRASH)

    private fun act(name: String): Result<Unit> { calls += name; if (actionResult.isSuccess) afterAction?.invoke(); return actionResult }
    override suspend fun pin(ref: ChatRef, pinned: Boolean) = act("pin ${ref.key} $pinned")
    override suspend fun markRead(ref: ChatRef) = act("read ${ref.key}")
    override suspend fun mute(ref: ChatRef, muted: Boolean) = act("mute ${ref.key} $muted")
    override suspend fun snooze(ref: ChatRef, untilIso: String?) = act("snooze ${ref.key} $untilIso")
    override suspend fun rename(ref: ChatRef, title: String) = act("rename ${ref.key} $title")
    override suspend fun archive(ref: ChatRef) = act("archive ${ref.key}")
    override suspend fun moveToSection(ref: ChatRef, section: Long?) = act("move ${ref.key} $section")
    override suspend fun createSection(name: String): Result<Long> = act("createSection $name").map { 99L }
    override suspend fun renameSection(id: Long, name: String) = act("renameSection $id $name")
    override suspend fun deleteSection(id: Long) = act("deleteSection $id")

    override suspend fun search(q: String): Result<SearchResults> {
        searches += q
        searchGate?.await()
        return searchResult
    }

    override suspend fun searchSaved(q: String) = savedResult
}
