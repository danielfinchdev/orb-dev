package dev.orb.app.approve

import dev.orb.app.lock.AuthCapability
import dev.orb.app.lock.AuthRequest
import dev.orb.app.lock.AuthResult
import dev.orb.app.lock.Authenticator
import dev.orb.app.ui.theme.MemoryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/** A software key standing for the Keystore's: it signs with no fingerprint, and counts what was asked of it. */
private class FakeCrypto : ApproveCrypto {
    var pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    var has = false
    var created = 0
    var invalidated = false
    override fun hasKey() = has
    override fun createKey(): Boolean { created += 1; has = true; invalidated = false; return true }
    override fun publicKey(): ByteArray? = if (has) Sec1.of(pair.public as ECPublicKey) else null
    override fun prepareSign(): ApproveSigner {
        if (!has) return ApproveSigner.Missing
        if (invalidated) return ApproveSigner.Invalidated
        return ApproveSigner.Ready(Signature.getInstance("SHA256withECDSA").apply { initSign(pair.private) })
    }
    override fun sign(signature: Signature, message: ByteArray): ByteArray? = signature.run { update(message); sign() }
    override fun clear() { has = false }
}

private class FakeAuth(var strong: Boolean = true) : Authenticator {
    val requests = mutableListOf<AuthRequest>()
    private var pending: ((AuthResult) -> Unit)? = null
    override fun capability() = AuthCapability.Ready
    override fun strongBiometric() = strong
    override fun authenticate(request: AuthRequest, onResult: (AuthResult) -> Unit) { requests += request; pending = onResult }
    fun answer(r: AuthResult) { pending!!.also { pending = null }.invoke(r) }
}

class ApproverTest {
    private val b64 = Base64.getEncoder()
    private val pcPub = ByteArray(32) { (it + 1).toByte() }
    private val now = 1_800_000_000_000L
    private val crypto = FakeCrypto()
    private val auth = FakeAuth()
    private val store = MemoryStore()
    private val sent = mutableListOf<Pair<String, JsonObject>>()
    private var reply: JsonElement = buildJsonObject { put("ok", true) }
    private val approver = Approver(
        crypto, store, { LinkIdentity("dev-1", pcPub) }, { auth },
        { m, p -> sent += m to p; Result.success(reply) }, CoroutineScope(Dispatchers.Unconfined), { now },
    )

    private fun event(action: String, summary: String, orb: String = "orb-1", device: String = "dev-1", pc: ByteArray = pcPub, until: Long = now + 120_000, nonceByte: Int = 7, tamperedSummary: String? = null): JsonObject {
        val payload = ApprovePayload(action, ApprovePayload.sha256(summary), ByteArray(32) { nonceByte.toByte() }, orb, device, pc, until)
        return buildJsonObject {
            put("kind", "approve") // a field beside the signed bytes: never what decides
            put("payload", b64.encodeToString(payload.encode()))
            put("summary", tamperedSummary ?: summary)
        }
    }

    /** What the PC's vault checks: the signature over the very bytes of the event, by the key it was given. */
    private fun verifies(event: JsonObject, publicKey: java.security.PublicKey, signature: ByteArray): Boolean {
        val bytes = Base64.getDecoder().decode((event["payload"] as JsonPrimitive).content)
        return Signature.getInstance("SHA256withECDSA").run { initVerify(publicKey); update(bytes); verify(signature) }
    }

    private fun register() {
        val e = event(ApproveRules.ENROLL, """{"name":"Pixel de Dani"}""")
        approver.onEvent(e)
        approver.confirm()
        auth.answer(AuthResult.Signed(crypto.prepareSign().let { (it as ApproveSigner.Ready).signature }))
    }

    @Test fun aKeyIsMadeOnlyWhenThePcRegistersThePhoneAndThePersonConfirms() {
        approver.onEvent(event(ApproveRules.ENROLL, """{"name":"Pixel de Dani"}"""))
        val ui = approver.ui.value!!
        assertEquals(ApproveKind.Enroll, ui.request!!.kind)
        assertTrue(ui.body.contains("Pixel de Dani"))
        assertEquals("nothing is made by looking at the request", 0, crypto.created)
        approver.confirm()
        assertEquals(1, crypto.created)
        val asked = auth.requests.single()
        assertNotNull("bound to the signing key, strong biometrics only", asked.signature)
        assertNull(asked.cipher)
        auth.answer(AuthResult.Signed(crypto.prepareSign().let { (it as ApproveSigner.Ready).signature }))
        val (method, params) = sent.single()
        assertEquals("approve.enroll", method)
        val sig = Base64.getDecoder().decode(params.getValue("sig").let { (it as JsonPrimitive).content })
        val pub = Base64.getDecoder().decode((params.getValue("pub") as JsonPrimitive).content)
        assertEquals(65, pub.size)
        assertEquals(4, pub[0].toInt())
        assertTrue(verifies(event(ApproveRules.ENROLL, """{"name":"Pixel de Dani"}"""), crypto.pair.public, sig))
        assertEquals("nonce comes from the signed bytes", b64.encodeToString(ByteArray(32) { 7 }), (params.getValue("nonce") as JsonPrimitive).content)
        assertEquals("this PC is pinned from now on", "orb-1", store.getString("approve.orb"))
        assertTrue(store.getBoolean("approve.registered", false))
    }

    @Test fun aPhoneNobodyRegisteredApprovesNothingAndMakesNoKey() {
        approver.onEvent(event("secrets.connector", """{"name":"github"}"""))
        val ui = approver.ui.value!!
        assertNull(ui.request)
        assertEquals(ApproveTexts.REREGISTER_TITLE, ui.title)
        assertEquals(0, crypto.created)
        assertTrue(auth.requests.isEmpty())
    }

    @Test fun aRegisteredPhonePaintsTheActionFromTheSignedBytesAndAnswersWithItsSignature() {
        register()
        sent.clear(); approver.dismiss()
        val e = event("secrets.connector", """{"name":"github"}""", nonceByte = 9)
        approver.onEvent(e)
        val ui = approver.ui.value!!
        assertEquals(ApproveTexts.actionTitle("secrets.connector"), ui.title)
        assertEquals("""{"name":"github"}""", ui.summary)
        approver.confirm()
        auth.answer(AuthResult.Signed(crypto.prepareSign().let { (it as ApproveSigner.Ready).signature }))
        val (method, params) = sent.single()
        assertEquals("approve.respond", method)
        assertTrue(verifies(e, crypto.pair.public, Base64.getDecoder().decode((params.getValue("sig") as JsonPrimitive).content)))
        assertEquals(ApproveTexts.DONE_TITLE, approver.ui.value!!.title)
    }

    @Test fun aSummaryThatDoesNotHashToTheSignedHashIsNeverShown() {
        register(); approver.dismiss()
        approver.onEvent(event("secrets.connector", """{"name":"github"}""", tamperedSummary = """{"name":"otro"}"""))
        assertNull(approver.ui.value)
    }

    @Test fun otherPhonesOtherPcsAndLateRequestsAreIgnored() {
        register(); approver.dismiss()
        for (e in listOf(
            event("secrets.connector", "{}", device = "dev-9"),
            event("secrets.connector", "{}", pc = ByteArray(32)),
            event("secrets.connector", "{}", orb = "orb-2"),
            event("secrets.connector", "{}", until = now - 1),
            event("secrets.connector", "{}", until = now + 10 * 60_000),
        )) {
            approver.onEvent(e)
            assertNull(approver.ui.value)
        }
        approver.onEvent(JsonPrimitive("not an object"))
        assertNull(approver.ui.value)
    }

    @Test fun aNewFingerprintKillsTheKeyAndThePhoneNeverMakesAnotherOnItsOwn() {
        register(); approver.dismiss()
        val created = crypto.created
        crypto.invalidated = true
        approver.onEvent(event("secrets.connector", """{"name":"github"}""", nonceByte = 3))
        approver.confirm()
        assertEquals(ApproveTexts.REREGISTER_TITLE, approver.ui.value!!.title)
        assertFalse(store.getBoolean("approve.registered", false))
        assertFalse(crypto.has)
        approver.onEvent(event("secrets.connector", """{"name":"github"}""", nonceByte = 4))
        assertEquals(ApproveTexts.REREGISTER_TITLE, approver.ui.value!!.title)
        assertEquals("no key was made", created, crypto.created)
    }

    @Test fun withoutAStrongBiometricNothingIsMadeOrSigned() {
        auth.strong = false
        approver.onEvent(event(ApproveRules.ENROLL, """{"name":"Pixel"}"""))
        approver.confirm()
        assertEquals(ApproveTexts.NO_STRONG, approver.ui.value!!.body)
        assertEquals(0, crypto.created)
        assertTrue(auth.requests.isEmpty())
    }

    @Test fun cancellingKeepsTheRequestAndARefusedAnswerSaysSo() {
        register(); sent.clear(); approver.dismiss()
        approver.onEvent(event("secrets.connector", "{}", nonceByte = 5))
        approver.confirm()
        auth.answer(AuthResult.Cancelled)
        assertNotNull(approver.ui.value!!.request)
        assertFalse(approver.ui.value!!.busy)
        approver.confirm()
        reply = buildJsonObject { put("ok", false); put("reason", "nonce") }
        auth.answer(AuthResult.Signed(crypto.prepareSign().let { (it as ApproveSigner.Ready).signature }))
        assertEquals(ApproveTexts.REFUSED, approver.ui.value!!.body)
    }

    @Test fun forgettingTheLinkDropsTheKeyAndThePin() {
        register()
        approver.forget()
        assertFalse(crypto.has)
        assertNull(store.getString("approve.orb"))
        assertNull(approver.ui.value)
    }
}
