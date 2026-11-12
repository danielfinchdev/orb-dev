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
import dev.orb.app.link.api.PcCaller
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.notify.AndroidNetworkWatcher
import dev.orb.app.notify.AndroidNotePoster
import dev.orb.app.notify.AndroidNotificationAccess
import dev.orb.app.notify.AndroidServiceLauncher
import dev.orb.app.notify.KeepAliveController
import dev.orb.app.notify.KeepAlivePolicy
import dev.orb.app.notify.LinkKind
import dev.orb.app.notify.NoteActionRunner
import dev.orb.app.notify.NoteIntents
import dev.orb.app.notify.NoteJobs
import dev.orb.app.notify.Notifier
import dev.orb.app.notify.NotifyPrefs
import dev.orb.app.notify.NotifyTexts
import dev.orb.app.notify.ServiceLauncher
import dev.orb.app.notify.SharedPrefsJobStorage
import dev.orb.app.ui.notes.NoticeTarget
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
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
import kotlinx.coroutines.flow.getAndUpdate
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

    @Volatile
    private var foreground = false
    private val runtimeLock = Any()

    /** What the phone remembers about its notices and the «Mantener conectado» service; not secrets. */
    val notifyPrefs = NotifyPrefs(SharedPrefsStore(app.getSharedPreferences("orb.notify", android.content.Context.MODE_PRIVATE)))
    val noteJobs = NoteJobs(SharedPrefsJobStorage(app.getSharedPreferences("orb.notes", android.content.Context.MODE_PRIVATE)))
    private val notePoster = AndroidNotePoster(app, noteJobs)
    val notificationAccess = AndroidNotificationAccess(app, notifyPrefs)
    val keepAliveLauncher: ServiceLauncher = AndroidServiceLauncher(app)
    private val keepAliveRunning = MutableStateFlow(false)
    private var notifier: Notifier? = null
    private var notifierJob: Job? = null

    /** Where a tapped notice leads; the navigation takes it once. */
    val openTarget = MutableStateFlow<NoticeTarget?>(null)

    /** Pictures and files waiting to be sent, and content shared from other apps, live here only until the message goes. */
    private val attachRoot = java.io.File(app.cacheDir, "capturas")
    private val shareRoot = java.io.File(app.cacheDir, "compartido")

    // A previous run may have been killed with copies still in the cache.
    init {
        attachRoot.deleteRecursively()
        shareRoot.deleteRecursively()
    }

    /** The optional app lock (off by default). It keeps a flag and a delay; the secret is the system's own authentication. */
    val lockPrefs = dev.orb.app.lock.LockPrefs(SharedPrefsStore(app.getSharedPreferences("orb.lock", android.content.Context.MODE_PRIVATE)))
    val lock = dev.orb.app.lock.AppLock(lockPrefs, dev.orb.app.lock.AppLockGate(lockPrefs, android.os.SystemClock::elapsedRealtime))

    /** What the app lock plugs into: the content (and shared content) is shown only while this is open. */
    val gate: dev.orb.app.share.AppGate get() = lock.gate

    /** Content another app shared, kept until the person chooses where it goes (or drops it). */
    val pendingShare = MutableStateFlow<dev.orb.app.share.ShareRequest?>(null)

    /** Copies what [intent] shares into the cache off the main thread; ignores any other intent. */
    fun receiveShare(intent: android.content.Intent?) {
        if (!dev.orb.app.share.ShareReader.isShare(intent)) return
        val shared = intent ?: return
        scope.launch(Dispatchers.IO) {
            val io = dev.orb.app.share.ContentShareIo(app.contentResolver)
            val request = try { dev.orb.app.share.ShareReader.read(shared, io, shareRoot) } catch (_: Exception) { null } ?: return@launch
            pendingShare.getAndUpdate { request }?.deleteFiles()
        }
        // The same intent must not be read again when the screen is recreated.
        shared.action = android.content.Intent.ACTION_MAIN
    }

    fun dropShare() {
        pendingShare.getAndUpdate { null }?.deleteFiles()
    }

    /** The share screen takes over the request (and the duty to delete its copies). */
    fun takeShare(): dev.orb.app.share.ShareRequest? = pendingShare.getAndUpdate { null }

    fun shareBackend(): dev.orb.app.ui.share.ShareBackend? = _runtime.value?.let { dev.orb.app.ui.share.RuntimeShareBackend(this, it) }

    /** A fresh set of attachments for one chat screen; each has its own folder so two chats never mix files. */
    fun attachController(parent: kotlinx.coroutines.CoroutineScope = scope): dev.orb.app.attach.AttachController =
        dev.orb.app.attach.AttachController(
            parent, dev.orb.app.attach.ContentIo(app.contentResolver),
            dev.orb.app.attach.AttachUploader { bytes, mime, name ->
                val rt = _runtime.value ?: return@AttachUploader Result.failure(dev.orb.app.link.net.LinkException(dev.orb.app.link.net.LinkError.NotLinked))
                rt.client.upload(bytes, mime, name)
            },
            { dev.orb.app.attach.UploadPolicy.fromMe(_runtime.value?.client?.pcInfo?.value?.raw) },
            java.io.File(attachRoot, java.util.UUID.randomUUID().toString()),
        )

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

    /** Controls the foreground service from the setting, the link and the network. */
    private val keepAlive = KeepAliveController(
        KeepAlivePolicy(System::currentTimeMillis),
        enabled = notifyPrefs.settings.map { it.keepConnected }.distinctUntilChanged(),
        // Emits only once the saved link is known, so a service started at boot is not stopped while it is read.
        kind = flow {
            startup.await()
            emitAll(runtime.flatMapLatest { rt -> if (rt == null) flowOf(LinkKind.Terminal) else rt.client.connection.map(LinkKind::of) })
        }.distinctUntilChanged(),
        network = AndroidNetworkWatcher(app),
        launcher = keepAliveLauncher,
        log = log::add,
    ).also { it.start(scope) }

    /** The fixed notice of the service: who it is connected to. */
    val keepAliveText: StateFlow<String> = runtime.flatMapLatest { rt ->
        if (rt == null) flowOf(NotifyTexts.connected(null))
        else rt.client.connection.map { c ->
            val pc = (c as? ConnectionState.Online)?.pcName ?: rt.client.pcInfo.value?.name ?: rt.client.currentSession.name
            if (c is ConnectionState.Online) NotifyTexts.connected(pc) else NotifyTexts.searching(pc)
        }
    }.stateIn(scope, SharingStarted.WhileSubscribed(5_000), NotifyTexts.connected(null))

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
        notifierJob?.cancel()
        notifier = Notifier(client.events, { notifyPrefs.settings.value.copy(appLock = lockPrefs.settings.value.enabled) }, { foreground }, notePoster, log::add)
        notifierJob = notifier?.start(scope)
        notifyPrefs.linked = true
        val runtime = LinkRuntime(client, api, sender)
        synchronized(runtimeLock) {
            _runtime.value = runtime
            client.start()
            if (!foreground && !keepAliveRunning.value) client.pause()
        }
    }

    /** Forgets the PC: the link keys, the cache and the unsent messages. */
    suspend fun unlink() = withContext(Dispatchers.IO) {
        val current = synchronized(runtimeLock) { _runtime.value.also { _runtime.value = null; notes?.second?.close(); notes = null } }
        current?.client?.stop()
        current?.sender?.cancel()
        notifierJob?.cancel()
        notifier = null
        notePoster.clearNotes()
        notifyPrefs.linked = false
        notifyPrefs.setKeepConnected(true)
        notifyPrefs.setLockScreenPublic(false)
        SecureStore.remove(app, SESSION_KEY)
        wipe.wipe()
        outboxLock.withLock { outboxFor = null; outboxRepo = null }
    }

    fun onForeground() = synchronized(runtimeLock) {
        foreground = true
        lock.gate.onForeground()
        _runtime.value?.client?.resume()
        // The app lists the notices itself now.
        notifier?.onForeground()
        Unit
    }

    fun onBackground() = synchronized(runtimeLock) {
        foreground = false
        lock.gate.onBackground()
        if (!keepAliveRunning.value) _runtime.value?.client?.pause()
        Unit
    }

    /** The service says it is running: the link then stays open in the background too. */
    fun setKeepAlive(on: Boolean) = synchronized(runtimeLock) {
        keepAliveRunning.value = on
        val client = _runtime.value?.client
        if (on) client?.resume() else if (!foreground) client?.pause()
        Unit
    }

    /** A notice's button, answered with the app closed (see [dev.orb.app.notify.NoteReceiver]). */
    suspend fun answerNote(token: String, typed: String?) {
        val keyguard = app.getSystemService(android.app.KeyguardManager::class.java)
        val runner = NoteActionRunner(
            noteJobs,
            caller = { startup.await(); _runtime.value?.let { PcCaller.of(it.client) } },
            isLocked = { keyguard?.isDeviceLocked == true },
            onStart = { notePoster.say(it, NotifyTexts.SENDING, null) },
        )
        val (job, outcome) = runner.run(token, typed) ?: return
        notePoster.say(job, outcome.text, if (outcome.done) 4_000L else null)
        log.add("aviso respondido")
    }

    /** A tap on a notice: where it leads, if the intent carries a valid one-use token of this app's own. */
    fun openFromNotification(intent: android.content.Intent?) {
        val token = intent?.getStringExtra(NoteIntents.EXTRA_TOKEN) ?: return
        intent.removeExtra(NoteIntents.EXTRA_TOKEN)
        // MainActivity is exported: only a token kept here counts, never extras made up by another app.
        val target = noteJobs.take(token)?.target?.toNotice() ?: return
        openTarget.value = target
    }

    fun linkTestBackend(): LinkTestBackend? = _runtime.value?.let { RuntimeBackend(this, it) }

    fun chatsBackend(): ChatsBackend? = _runtime.value?.let { RuntimeChatsBackend(this, it) }

    /** One Orbe conversation; null until a PC is linked. */
    fun orbeChatBackend(): dev.orb.app.ui.chats.OrbeChatBackend? = _runtime.value?.let { dev.orb.app.ui.chats.RuntimeOrbeChatBackend(this, it) }
    fun directChatBackend(): dev.orb.app.ui.chats.DirectChatBackend? = _runtime.value?.let { dev.orb.app.ui.chats.RuntimeDirectChatBackend(this, it) }
    fun tasksBackend(): dev.orb.app.ui.tasks.TasksBackend? = _runtime.value?.let { dev.orb.app.ui.tasks.RuntimeTasksBackend(this, it) }
    fun projectsBackend(): dev.orb.app.ui.projects.ProjectsBackend? = _runtime.value?.let { dev.orb.app.ui.projects.RuntimeProjectsBackend(it, chatsBackend()) }
    fun schedulesBackend(): dev.orb.app.ui.schedules.SchedulesBackend? = _runtime.value?.let { dev.orb.app.ui.schedules.RuntimeSchedulesBackend(it) }
    fun usageBackend(): dev.orb.app.ui.usage.UsageBackend? = _runtime.value?.let { dev.orb.app.ui.usage.RuntimeUsageBackend(it) }
    private var notes: Pair<LinkRuntime, dev.orb.app.ui.notes.RuntimeNotesBackend>? = null

    /** One notices list per link, so the bell keeps counting while the center is closed. */
    fun notesBackend(): dev.orb.app.ui.notes.NotesBackend? = synchronized(runtimeLock) {
        val rt = _runtime.value ?: return null
        notes?.takeIf { it.first === rt }?.second ?: dev.orb.app.ui.notes.RuntimeNotesBackend(rt, scope).also { notes?.second?.close(); notes = rt to it }
    }

    fun activityBackend(): dev.orb.app.ui.menu.ActivityBackend? = _runtime.value?.let { dev.orb.app.ui.menu.RuntimeActivityBackend(it) }
    fun newChatBackend(): dev.orb.app.ui.chats.NewChatBackend? = _runtime.value?.let { dev.orb.app.ui.chats.RuntimeNewChatBackend(it) }

    private companion object {
        const val SESSION_KEY = "orb.movil"
    }
}
