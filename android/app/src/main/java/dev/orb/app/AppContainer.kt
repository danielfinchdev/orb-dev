package dev.orb.app

import android.app.Application
import android.os.Build
import dev.orb.app.data.CacheDao
import dev.orb.app.data.CacheSync
import dev.orb.app.data.CacheWipe
import dev.orb.app.data.DatabaseFactory
import dev.orb.app.data.KeystoreCacheKey
import dev.orb.app.data.OrbCacheDatabase
import dev.orb.app.data.OutboxRepository
import dev.orb.app.data.OutboxSender
import dev.orb.app.link.api.OrbApi
import dev.orb.app.link.net.Clock
import dev.orb.app.link.net.LinkClient
import dev.orb.app.link.net.LinkSession
import dev.orb.app.link.net.LinkSessionCodec
import dev.orb.app.link.net.PairOk
import dev.orb.app.link.net.Pairing
import dev.orb.app.link.net.ResolvedLink
import dev.orb.app.link.payload.LinkPayload
import dev.orb.app.ui.LinkTestBackend
import dev.orb.app.ui.chats.ChatsBackend
import dev.orb.app.ui.chats.RuntimeChatsBackend
import dev.orb.app.ui.Linker
import dev.orb.app.ui.RuntimeBackend
import dev.orb.app.ui.theme.SharedPrefsStore
import dev.orb.app.ui.theme.ThemePrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient

/** Everything that lives and dies with a linked phone. */
class LinkRuntime(val client: LinkClient, val api: OrbApi, val sender: Job)

/**
 * Manual dependency injection: one of each long-lived object, built once by [OrbApplication]. The app is a remote
 * control of the PC, so the only things kept on the phone are the encrypted cache, the send queue and the link keys.
 */
class AppContainer(private val app: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val http: OkHttpClient = OkHttpClient.Builder().build()
    val log = EventLog()
    /** How the app looks; not a secret, kept in plain preferences. */
    val themePrefs = ThemePrefs(SharedPrefsStore(app.getSharedPreferences("orb.theme", android.content.Context.MODE_PRIVATE)))
    val deviceName: String = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android"

    private val keys = KeystoreCacheKey(app)
    private val databaseFactory = DatabaseFactory(app.getDatabasePath(OrbCacheDatabase.FILE_NAME), keys, DatabaseFactory.sqlcipher(app))
    private val wipe = CacheWipe(databaseFactory, keys)

    private val _runtime = MutableStateFlow<LinkRuntime?>(null)
    val runtime: StateFlow<LinkRuntime?> = _runtime.asStateFlow()

    private var foreground = false
    private val runtimeLock = Any()

    val linker: Linker = Pairing(http).let { p ->
        object : Linker {
            override suspend fun resolve(payload: LinkPayload) = p.resolve(payload)
            override suspend fun link(link: ResolvedLink, password: String, deviceName: String) = p.link(link, password, deviceName)
        }
    }

    /** Reads the saved link off the main thread (the Keystore can be slow); true when the phone is linked. */
    val startup = scope.async(Dispatchers.IO) {
        val session = try { LinkSessionCodec.decode(SecureStore.get(app, SESSION_KEY)) } catch (e: SecureStore.Busy) { null }
        if (session != null) startRuntime(session, 0)
        session != null
    }

    /** The database, opened off the main thread; null while the Keystore is busy. */
    suspend fun database(): OrbCacheDatabase? = withContext(Dispatchers.IO) { databaseFactory.open() }

    private val outboxLock = Mutex()
    private var outboxFor: OrbCacheDatabase? = null
    private var outboxRepo: OutboxRepository? = null

    /** One repository per open database, shared by the sender and the screens so they see the same changes. */
    suspend fun outbox(): OutboxRepository? = outboxLock.withLock {
        val db = database() ?: return@withLock null
        if (outboxFor !== db) { outboxRepo = OutboxRepository(db.outbox()); outboxFor = db }
        outboxRepo
    }

    suspend fun cacheDao(): CacheDao? = database()?.cache()

    suspend fun cacheSync(): CacheSync? = database()?.let { CacheSync(it.cache(), it.outbox()) }

    /** Called with the result of a successful pairing: saves the link and starts using it. */
    fun linkWith(ok: PairOk) {
        SecureStore.set(app, SESSION_KEY, LinkSessionCodec.encode(ok.session))
        startRuntime(ok.session, ok.skewMs)
    }

    private fun startRuntime(session: LinkSession, skewMs: Long) {
        val client = LinkClient(
            session = session, http = http, clock = Clock.System, scope = scope, initialSkewMs = skewMs,
            onSessionChanged = { next -> runCatching { SecureStore.set(app, SESSION_KEY, LinkSessionCodec.encode(next)) } },
            onProblem = { type -> log.add("problema $type") },
        )
        val api = OrbApi(client)
        val sender = scope.launch {
            val repo = outbox() ?: return@launch
            OutboxSender(repo, api, client.connection, this).start().join()
        }
        scope.launch { client.connection.map { it::class.simpleName ?: "?" }.distinctUntilChanged().collect { log.add("conexión $it") } }
        val runtime = LinkRuntime(client, api, sender)
        synchronized(runtimeLock) {
            _runtime.value = runtime
            client.start()
            if (!foreground) client.pause()
        }
    }

    /** Forgets the PC: the link keys, the cache and the unsent messages. */
    suspend fun unlink() = withContext(Dispatchers.IO) {
        val current = synchronized(runtimeLock) { _runtime.value.also { _runtime.value = null } }
        current?.client?.stop()
        current?.sender?.cancel()
        SecureStore.remove(app, SESSION_KEY)
        wipe.wipe()
        outboxLock.withLock { outboxFor = null; outboxRepo = null }
    }

    fun onForeground() = synchronized(runtimeLock) { foreground = true; _runtime.value?.client?.resume() ?: Unit }
    fun onBackground() = synchronized(runtimeLock) { foreground = false; _runtime.value?.client?.pause() ?: Unit }

    fun linkTestBackend(): LinkTestBackend? = _runtime.value?.let { RuntimeBackend(this, it) }

    fun chatsBackend(): ChatsBackend? = _runtime.value?.let { RuntimeChatsBackend(this, it) }

    /** One Orbe conversation; null until a PC is linked. */
    fun orbeChatBackend(): dev.orb.app.ui.chats.OrbeChatBackend? = _runtime.value?.let { dev.orb.app.ui.chats.RuntimeOrbeChatBackend(this, it) }
    fun directChatBackend(): dev.orb.app.ui.chats.DirectChatBackend? = _runtime.value?.let { dev.orb.app.ui.chats.RuntimeDirectChatBackend(this, it) }
    fun tasksBackend(): dev.orb.app.ui.tasks.TasksBackend? = _runtime.value?.let { dev.orb.app.ui.tasks.RuntimeTasksBackend(it) }
    fun projectsBackend(): dev.orb.app.ui.projects.ProjectsBackend? = _runtime.value?.let { dev.orb.app.ui.projects.RuntimeProjectsBackend(it) }
    fun newChatBackend(): dev.orb.app.ui.chats.NewChatBackend? = _runtime.value?.let { dev.orb.app.ui.chats.RuntimeNewChatBackend(it) }

    private companion object {
        const val SESSION_KEY = "orb.movil"
    }
}
