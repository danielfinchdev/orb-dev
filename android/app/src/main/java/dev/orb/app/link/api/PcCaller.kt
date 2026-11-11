package dev.orb.app.link.api

import dev.orb.app.link.net.LinkClient
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** What [OrbApi] needs from the link: run a method, and know which newer methods the PC lists. */
interface PcCaller {
    suspend fun call(method: String, params: JsonObject): Result<JsonElement>
    fun supports(method: String): Boolean

    companion object {
        fun of(client: LinkClient): PcCaller = object : PcCaller {
            override suspend fun call(method: String, params: JsonObject) = client.call(method, params)
            override fun supports(method: String) = client.pcSupports(method)
        }
    }
}
