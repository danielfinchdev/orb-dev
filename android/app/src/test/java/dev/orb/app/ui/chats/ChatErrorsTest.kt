package dev.orb.app.ui.chats

import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The PC refuses in the language Orb is set to there, and the phone tells the cases apart by those words: each one
 * must be recognised in Spanish and in English (the sentences are the ones of src/shared/locales on the PC).
 */
class ChatErrorsTest {
    private fun refused(msg: String) = LinkException(LinkError.Refused(400, msg))

    @Test
    fun aQueuedMessageThatChangedIsRecognisedInBothLanguages() {
        assertTrue(ChatErrors.queuedChanged(refused("el mensaje en cola ha cambiado desde que lo viste; ábrelo de nuevo")))
        assertTrue(ChatErrors.queuedChanged(refused("the waiting message has changed since you saw it; open it again")))
        assertFalse(ChatErrors.queuedChanged(refused("that conversation no longer exists")))
    }

    @Test
    fun aDeletedChatIsRecognisedInBothLanguages() {
        assertTrue(ChatErrors.deleted(refused("esa conversación ya no existe")))
        assertTrue(ChatErrors.deleted(refused("Ese chat está en la papelera. Restáuralo para seguir.")))
        assertTrue(ChatErrors.deleted(refused("That conversation no longer exists.")))
        assertTrue(ChatErrors.deleted(refused("That chat is in the trash. Restore it to continue.")))
        assertFalse(ChatErrors.deleted(refused("the waiting message has changed since you saw it; open it again")))
    }

    @Test
    fun aFailureThatIsNotARefusalIsNoneOfThem() {
        val e = RuntimeException("ya no existe")
        assertFalse(ChatErrors.deleted(e))
        assertFalse(ChatErrors.queuedChanged(e))
    }
}
