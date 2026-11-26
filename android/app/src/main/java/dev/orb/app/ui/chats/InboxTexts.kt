package dev.orb.app.ui.chats

import java.util.Locale

/**
 * Texts of the «Prioridad» order and of the summary of the day, in Spanish and English like the PC's `orbchats.*`
 * keys. The language is the phone's; anything that is not English reads Spanish, as the rest of the app does.
 */
class InboxTexts(val english: Boolean) {
    private fun pick(es: String, en: String) = if (english) en else es

    val priority get() = pick("Prioridad", "Priority")
    val priorityHint get() = pick("Prioridad: lo que te necesita primero", "Priority: what needs you first")
    val reorder get() = pick("Reordenar por prioridad", "Reorder by priority")
    val digestTitle get() = pick("Resumen de ayer", "Yesterday's summary")
    val digestClose get() = pick("Cerrar el resumen", "Close the summary")
    val needsReview get() = pick("Espera tu aprobación", "Waiting for your approval")
    fun done(n: Int) = pick("Tareas hechas: $n", "Tasks done: $n")
    fun failed(n: Int) = pick("Tareas que fallaron: $n", "Tasks that failed: $n")
    fun entries(n: Int) = pick("Entradas en la bitácora: $n", "Journal entries: $n")
    fun approvals(n: Int) = pick("Esperan tu aprobación ahora: $n", "Waiting for your approval now: $n")
    fun held(n: Int) = pick("Retenidas para que las revises ahora: $n", "Held for your review now: $n")
    val usage get() = pick("Uso por proveedor", "Usage by provider")
    fun turns(n: Int) = pick("$n turnos", if (n == 1) "1 turn" else "$n turns")

    companion object {
        fun forLanguage(language: String?) = InboxTexts(language.equals("en", ignoreCase = true))
        fun current() = forLanguage(Locale.getDefault().language)
    }
}
