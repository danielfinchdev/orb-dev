package dev.orb.app.ui.share

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.orb.app.AppContainer
import dev.orb.app.LinkRuntime
import dev.orb.app.attach.AttachController
import dev.orb.app.attach.AttachTexts
import dev.orb.app.share.ShareRequest
import dev.orb.app.ui.chats.ChatKind
import dev.orb.app.ui.chats.ChatRef
import dev.orb.app.ui.chats.ChatRow
import dev.orb.app.ui.chats.RuntimeChatsBackend
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Where shared content can go. */
sealed interface ShareDest {
    data class Chat(val ref: ChatRef) : ShareDest
    data object NewOrbe : ShareDest
    data class Project(val name: String) : ShareDest
}

/** What the share screen needs: the places to send to, and a way to queue the message. */
interface ShareBackend {
    fun recents(): Flow<List<ChatRow>>
    suspend fun projects(): List<String>

    /** Puts the message in the send queue (it leaves when there is a link) → the chat to open, if one exists already. */
    suspend fun send(dest: ShareDest, text: String, images: List<String>): Result<Unit>
}

class RuntimeShareBackend(private val container: AppContainer, private val runtime: LinkRuntime) : ShareBackend {
    override fun recents(): Flow<List<ChatRow>> =
        RuntimeChatsBackend(container, runtime).inbox().map { data ->
            data.rows.filter { !it.done }.sortedByDescending { it.at.orEmpty() }.take(RECENT)
        }

    override suspend fun projects(): List<String> =
        container.projectsBackend()?.list()?.getOrNull()?.projects?.map { it.name }.orEmpty()

    override suspend fun send(dest: ShareDest, text: String, images: List<String>): Result<Unit> = runCatching {
        val outbox = container.outbox() ?: throw dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.NotLinked)
        when (dest) {
            is ShareDest.Chat ->
                if (dest.ref.kind == ChatKind.Agent) outbox.enqueueSession(dest.ref.id, text, images) else outbox.enqueueChat(dest.ref.id, text, images)
            ShareDest.NewOrbe -> outbox.enqueueChat(null, text, images)
            is ShareDest.Project -> outbox.enqueueChat(null, text, images, buildJsonObject { put("project", dest.name) })
        }
        Unit
    }

    private companion object {
        const val RECENT = 8
    }
}

data class ShareState(
    val text: String = "",
    val dest: ShareDest = ShareDest.NewOrbe,
    val recents: List<ChatRow> = emptyList(),
    val projects: List<String> = emptyList(),
    val sending: Boolean = false,
    val message: String? = null,
    val textCut: Boolean = false,
    val skipped: Int = 0,
    val empty: Boolean = false,
)

/** The «Compartir con Orb» screen: edits the text, shows the files and sends to the chosen place. */
class ShareViewModel(
    private val backend: ShareBackend,
    private val request: ShareRequest,
    val attach: AttachController,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val onSent: (ShareDest) -> Unit = {},
) : ViewModel() {
    private val _state = MutableStateFlow(
        ShareState(text = request.text?.takeIf { it.isNotBlank() } ?: AttachTexts.SHARE_DEFAULT_TEXT.takeIf { request.files.isNotEmpty() }.orEmpty(), textCut = request.textCut, skipped = request.skipped, empty = request.isEmpty),
    )
    val state: StateFlow<ShareState> = _state

    init {
        viewModelScope.launch(ioDispatcher) {
            // The copies in the cache go into the same pipeline as a picked file, and are deleted once read. Each stays
            // in memory until it is uploaded, so the next one waits when that would pass one file's worth at once.
            var inMemory = 0L
            for (f in request.files) {
                val size = f.file.length()
                if (inMemory + size > MAX_IN_MEMORY) { attach.awaitIdle(); inMemory = 0 }
                val bytes = try { f.file.readBytes() } catch (_: Exception) { null }
                f.file.delete()
                if (bytes != null) { inMemory += bytes.size; attach.addBytes(f.name, f.mime, bytes) }
            }
        }
        viewModelScope.launch { backend.recents().collect { rows -> _state.value = _state.value.copy(recents = rows) } }
        viewModelScope.launch { _state.value = _state.value.copy(projects = backend.projects()) }
    }

    fun setText(t: String) { _state.value = _state.value.copy(text = t, message = null) }
    fun choose(d: ShareDest) { _state.value = _state.value.copy(dest = d, message = null) }

    fun send() {
        val s = _state.value
        if (s.sending) return
        // The person may have cleared the suggested text; a message with only a file still needs some words.
        val text = s.text.trim().ifEmpty { AttachTexts.SHARE_DEFAULT_TEXT.takeIf { attach.items.value.isNotEmpty() } }
            ?: return say(AttachTexts.SHARE_NEEDS_TEXT)
        if (attach.items.value.any { it.state != dev.orb.app.attach.AttachState.Ready }) return say(AttachTexts.WAIT_UPLOADS)
        val images = attach.remoteNames()
        _state.value = s.copy(sending = true, message = null)
        viewModelScope.launch {
            backend.send(s.dest, text, images).fold(
                onSuccess = { attach.discard(); onSent(s.dest) },
                onFailure = { _state.value = _state.value.copy(sending = false, message = AttachTexts.SHARE_FAILED) },
            )
        }
    }

    /** Dropped without sending: the copies go too. */
    fun discard() {
        attach.discard()
        request.deleteFiles()
    }

    private companion object {
        /** The most that the copies of a share hold in memory at once. */
        const val MAX_IN_MEMORY = 25L * 1024 * 1024
    }

    private fun say(text: String) { _state.value = _state.value.copy(message = text) }

    override fun onCleared() {
        attach.close()
        request.deleteFiles()
    }
}
