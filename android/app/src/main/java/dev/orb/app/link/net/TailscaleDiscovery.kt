package dev.orb.app.link.net

import dev.orb.app.link.payload.DEFAULT_PORT
import dev.orb.app.link.payload.allowedBase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request

/** An Orb that answered on the Tailscale network: the name it shows and the address the link continues with. */
data class FoundPc(val name: String, val base: String)

/** Looks for Orbs on the person's tailnet. Finding one links nothing: the pairing code and the master password are still asked. */
interface PcDiscovery {
    suspend fun find(typed: String): List<FoundPc>
}

/** Asks one address «is an Orb here?». Returns the Orb's name, or null when nothing (or something else) answers. */
fun interface DiscoverProbe {
    suspend fun probe(base: String): String?
}

/**
 * The addresses to try for what the person typed (the PC's name on Tailscale as Ajustes › Dispositivos shows it): the
 * full MagicDNS name is tried over https (what `tailscale serve` gives, with its certificate) and plain http; a short name
 * or a 100.x address only over plain http, which Tailscale's WireGuard already encrypts. Only addresses the app may use.
 */
fun tailscaleCandidates(typed: String, port: String = DEFAULT_PORT): List<String> {
    val host = typed.trim().lowercase().removePrefix("https://").removePrefix("http://").substringBefore('/').substringBefore(':').trimEnd('.')
    if (host.isEmpty() || !Regex("^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$").matches(host)) return emptyList()
    val full = host.endsWith(".ts.net")
    return (if (full) listOf("https://$host:$port", "http://$host:$port") else listOf("http://$host:$port")).filter { allowedBase(it) }
}

/** Tries all the candidates at once and keeps the ones where an Orb answers; one entry per PC, https first. */
class TailscaleDiscovery(private val probe: DiscoverProbe) : PcDiscovery {
    override suspend fun find(typed: String): List<FoundPc> = coroutineScope {
        val found = tailscaleCandidates(typed).map { base -> async { probe.probe(base)?.let { FoundPc(it, base) } } }.awaitAll().filterNotNull()
        // the same PC may answer on https and http: keep the first (https comes first in the candidates)
        found.distinctBy { it.name }
    }
}

/** The real probe: GET /api/discover with a short time limit. Anything that is not the Orb's own small answer is «nothing here». */
class HttpDiscoverProbe(private val http: OkHttpClient) : DiscoverProbe {
    override suspend fun probe(base: String): String? = try {
        val req = Request.Builder().url("$base/api/discover").get().build()
        http.forRequest(4_000, 3_000).newCall(req).await().use { res ->
            if (!res.isSuccessful) return null
            val o: JsonObject = Json.parseToJsonElement(res.peekBody(4096).string()).jsonObject
            if (o["orb"]?.jsonPrimitive?.content != "1") null else o["name"]?.jsonPrimitive?.content?.trim()?.take(60)?.takeIf { it.isNotEmpty() } ?: "Orb"
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }
}
