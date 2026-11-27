package dev.orb.app.approve

import dev.orb.app.lock.AuthRequest
import dev.orb.app.lock.AuthResult
import dev.orb.app.lock.Authenticator
import dev.orb.app.ui.theme.KeyValueStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Base64

/** This phone's side of its link: which device it is for the PC and the PC's public key. */
class LinkIdentity(val deviceId: String, val pcPub: ByteArray)

/** What the approval screen shows. [request] is null when it only tells something (no key, a refused request). */
data class ApproveUi(
    val title: String,
    val body: String,
    /** The parameters' summary, shown beside the action: it hashed to the signed hash. */
    val summary: String? = null,
    val request: ApproveRequest? = null,
    val busy: Boolean = false,
)

/** Whether this phone may approve the PC's actions now. */
enum class ApproveStatus { Allowed, NeedsAgain, NoStrong, NotYet }

/**
 * Approves the PC's sensitive actions with this phone's fingerprint. An `approve` event is held against this phone's own link and key
 * ([ApproveRules]); only then is the action painted, from the signed bytes. The key is made only when the PC registers this phone, and
 * the first signature (made with the fingerprint) proves it is there. A key killed by a new fingerprint is never made again by the phone:
 * it says so, and the PC registers it again.
 */
class Approver(
    private val crypto: ApproveCrypto,
    private val store: KeyValueStore,
    private val identity: () -> LinkIdentity?,
    private val authenticator: () -> Authenticator?,
    private val send: suspend (method: String, params: JsonObject) -> Result<JsonElement>,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _ui = MutableStateFlow<ApproveUi?>(null)

    /** Requests that came while another one was on screen: what is being read never changes under the person's finger. */
    private val queue = ArrayDeque<ApproveUi>()
    val ui: StateFlow<ApproveUi?> = _ui.asStateFlow()

    private fun registered() = store.getBoolean(REGISTERED, false) && crypto.hasKey()

    /** What «Este móvil» says about approving: only the PC makes the key, so «not yet» means going to the PC. */
    fun status(): ApproveStatus {
        val strong = authenticator()?.strongBiometric() == true
        val wasRegistered = store.getBoolean(REGISTERED, false) || store.getString(ORB) != null
        return when {
            !strong -> ApproveStatus.NoStrong
            registered() -> ApproveStatus.Allowed
            wasRegistered -> ApproveStatus.NeedsAgain
            else -> ApproveStatus.NotYet
        }
    }

    /** An `approve` event of the PC. */
    fun onEvent(payload: JsonElement) {
        val event = payload as? JsonObject ?: return
        val me = identity() ?: return
        val ctx = ApproveContext(me.deviceId, me.pcPub, store.getString(ORB), registered(), now())
        when (val check = ApproveRules.check(event, ctx)) {
            is ApproveCheck.Ok -> offer(uiOf(check.request))
            is ApproveCheck.Rejected -> if (check.reason == ApproveReject.NotRegistered) {
                // A phone that lost its key (a new fingerprint) says so; the PC registers it again. Nothing is made here.
                offer(ApproveUi(ApproveTexts.REREGISTER_TITLE, ApproveTexts.REREGISTER_BODY))
            }
        }
    }

    /** On screen at once when nothing is being asked; otherwise it waits its turn (a few at most, never the same one twice). */
    private fun offer(next: ApproveUi) {
        val showing = _ui.value
        if (showing?.request == null) { _ui.value = next; return }
        val nonce = next.request?.payload?.nonce
        val same = { u: ApproveUi -> u.request?.payload?.nonce?.contentEquals(nonce ?: ByteArray(0)) == true || (u.request == null && next.request == null && u.title == next.title) }
        if (same(showing) || queue.any(same)) return
        if (queue.size < MAX_QUEUE) queue.addLast(next)
    }

    private fun uiOf(r: ApproveRequest): ApproveUi {
        return when (r.kind) {
            ApproveKind.Enroll -> ApproveUi(ApproveTexts.ENROLL_TITLE, ApproveTexts.enrollBody(r.name.orEmpty()), request = r)
            ApproveKind.Rebuild -> ApproveUi(ApproveTexts.REBUILD_TITLE, ApproveTexts.REBUILD_BODY, request = r)
            ApproveKind.Approve -> ApproveUi(ApproveTexts.actionTitle(r.payload.action), ApproveTexts.APPROVE_BODY, summary = r.summary, request = r)
        }
    }

    fun dismiss() {
        if (_ui.value?.busy == true) return
        crypto.discardPending()
        _ui.value = nextLive()
    }

    /** The next waiting request that has not run out meanwhile. */
    private fun nextLive(): ApproveUi? {
        while (queue.isNotEmpty()) {
            val u = queue.removeFirst()
            if (u.request == null || u.request.payload.expires > now()) return u
        }
        return null
    }

    /** «Aprobar»: the fingerprint, bound to the signing key, then the signature goes to the PC. */
    fun confirm() {
        val current = _ui.value ?: return
        val request = current.request ?: return dismiss()
        if (current.busy) return
        val auth = authenticator()
        if (auth == null || !auth.strongBiometric()) return fail(request, ApproveTexts.NO_STRONG)
        _ui.value = current.copy(busy = true)
        val signer = if (request.kind == ApproveKind.Enroll) {
            // The PC asked for this registration and the person is looking at it: only now a key is made, beside the old one,
            // which stays in use until the PC accepts the new one.
            if (!crypto.createPending()) return fail(request, ApproveTexts.NO_STRONG)
            crypto.prepareSign(pending = true)
        } else {
            crypto.prepareSign()
        }
        when (signer) {
            is ApproveSigner.Ready -> auth.authenticate(AuthRequest(ApproveTexts.promptTitle(request), ApproveTexts.promptSubtitle(request), signature = signer.signature, negative = ApproveTexts.CANCEL)) { result ->
                when (result) {
                    is AuthResult.Signed -> signed(request, result)
                    AuthResult.Cancelled -> idle(request)
                    AuthResult.NotRecognized -> fail(request, ApproveTexts.NOT_RECOGNIZED)
                    AuthResult.Blocked -> fail(request, ApproveTexts.BLOCKED)
                    else -> fail(request, ApproveTexts.FAILED)
                }
            }
            ApproveSigner.Invalidated, ApproveSigner.Missing -> {
                // The key died with a new fingerprint: forget it and ask the PC to register again. Never made again here.
                crypto.clear()
                store.edit { putBoolean(REGISTERED, false) }
                _ui.value = ApproveUi(ApproveTexts.REREGISTER_TITLE, ApproveTexts.REREGISTER_BODY)
            }
            ApproveSigner.Failed -> fail(request, ApproveTexts.FAILED)
        }
    }

    private fun signed(r: ApproveRequest, result: AuthResult.Signed) {
        val sig = crypto.sign(result.signature, r.bytes) ?: return fail(r, ApproveTexts.FAILED)
        val b64 = Base64.getEncoder()
        val nonce = b64.encodeToString(r.payload.nonce)
        scope.launch {
            val answer = if (r.kind == ApproveKind.Enroll) {
                val pub = crypto.publicKey(pending = true) ?: return@launch fail(r, ApproveTexts.FAILED)
                send("approve.enroll", buildJsonObject { put("nonce", nonce); put("pub", b64.encodeToString(pub)); put("sig", b64.encodeToString(sig)) })
            } else {
                send("approve.respond", buildJsonObject { put("nonce", nonce); put("sig", b64.encodeToString(sig)) })
            }
            val ok = answer.getOrNull()?.let { (it as? JsonObject)?.get("ok") == JsonPrimitive(true) } == true
            if (!ok) return@launch fail(r, ApproveTexts.REFUSED)
            if (r.kind == ApproveKind.Enroll) {
                // The PC accepted it: the new key takes the old one's place.
                crypto.commit()
                store.edit { putString(ORB, r.payload.orbId); putBoolean(REGISTERED, true) }
            }
            _ui.value = ApproveUi(if (r.kind == ApproveKind.Enroll) ApproveTexts.ENROLLED_TITLE else ApproveTexts.DONE_TITLE, if (r.kind == ApproveKind.Enroll) ApproveTexts.ENROLLED_BODY else ApproveTexts.DONE_BODY)
        }
    }

    private fun idle(r: ApproveRequest) {
        if (r.kind == ApproveKind.Enroll) crypto.discardPending()
        _ui.value = _ui.value?.copy(busy = false, request = r)
    }

    private fun fail(r: ApproveRequest, text: String) {
        if (r.kind == ApproveKind.Enroll) crypto.discardPending()
        val base = _ui.value
        _ui.value = ApproveUi(base?.title ?: ApproveTexts.PROMPT_TITLE, text, base?.summary, r, busy = false)
    }

    /** The link was forgotten: nothing of the registration stays. */
    fun forget() {
        crypto.clear()
        store.edit { putBoolean(REGISTERED, false); putString(ORB, null) }
        queue.clear()
        _ui.value = null
    }

    private companion object {
        const val MAX_QUEUE = 5
        const val REGISTERED = "approve.registered"
        const val ORB = "approve.orb"
    }
}
