package dev.orb.app.attach

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AttachModelTest {
    @Test fun aPcWithoutUploadsTakesOnlyPictures() {
        val p = UploadPolicy.fromMe(Json.parseToJsonElement("""{"v":4}""").jsonObject)
        assertEquals(UploadPolicy.Legacy, p)
        assertTrue(p.allows(AttachType.Png))
        assertFalse(p.allows(AttachType.Pdf))
        assertFalse(p.allowsFiles)
        assertEquals(UploadPolicy.Legacy, UploadPolicy.fromMe(null))
    }

    @Test fun readsTheSizeAndKindsTheNewPcAnnounces() {
        val raw = Json.parseToJsonElement("""{"uploads":{"max":5242880,"types":["png","jpg","pdf","md"]}}""").jsonObject
        val p = UploadPolicy.fromMe(raw)
        assertEquals(5L * 1024 * 1024, p.maxBytes)
        assertTrue(p.allows(AttachType.Pdf))
        assertTrue(p.allows(AttachType.Md))
        assertFalse(p.allows(AttachType.Gif))
        assertTrue(p.allowsFiles)
    }

    @Test fun anEmptyOrBrokenAnnouncementFallsBackToPictures() {
        assertEquals(UploadPolicy.Legacy, UploadPolicy.fromMe(Json.parseToJsonElement("""{"uploads":{"max":9,"types":[]}}""").jsonObject))
        assertEquals(UploadPolicy.Legacy, UploadPolicy.fromMe(Json.parseToJsonElement("""{"uploads":"x"}""").jsonObject))
    }

    @Test fun detectsTheTypeByMimeThenByExtension() {
        assertEquals(AttachType.Jpg, AttachType.detect("image/jpeg", "IMG_1.jpeg"))
        assertEquals(AttachType.Pdf, AttachType.detect("application/pdf", "a.pdf"))
        assertEquals(AttachType.Pdf, AttachType.detect(null, "a.PDF"))
        // Providers call markdown, csv and json text/plain or octet-stream: the name decides among the text kinds.
        assertEquals(AttachType.Md, AttachType.detect("text/plain", "notas.md"))
        assertEquals(AttachType.Csv, AttachType.detect("application/octet-stream", "datos.csv"))
        assertEquals(AttachType.Json, AttachType.detect("application/json", "x"))
        assertEquals(AttachType.Txt, AttachType.detect("text/plain", "x"))
        assertNull(AttachType.detect("application/zip", "a.zip"))
        assertNull(AttachType.detect(null, null))
    }
}
