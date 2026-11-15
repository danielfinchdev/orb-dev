package dev.orb.app.link.api

import dev.orb.app.link.net.LinkClient
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** What [OrbApi] needs from the link: run a method, and know which newer methods the PC lists. */
interface PcCaller {
    suspend fun call(method: String, params: JsonObject): Result<JsonElement>
    fun supports(method: String): Boolean

    /** «Aprobar» / «Rechazar» of a notification with the one-use token the PC minted for it. */
    suspend fun noteAction(token: String): Result<Unit> = Result.failure(UnsupportedOperationException("noteAction"))

    companion object {
        fun of(client: LinkClient): PcCaller = object : PcCaller {
            override suspend fun call(method: String, params: JsonObject) = client.call(method, params)
            override fun supports(method: String) = client.pcSupports(method)
            override suspend fun noteAction(token: String) = client.noteAction(token)
        }
    }
}
