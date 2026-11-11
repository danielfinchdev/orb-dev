package dev.orb.app.data

import android.content.ContextWrapper
import androidx.room.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import dev.orb.app.link.api.OrbApi
import dev.orb.app.link.api.PcCaller
import dev.orb.app.link.net.ConnectionState
import dev.orb.app.link.net.LinkError
import dev.orb.app.link.net.LinkException
import dev.orb.app.link.net.PcVersions
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

/** The SQLCipher natives cannot load on the JVM; the same Room database runs here over the bundled plain SQLite. */
fun memoryDb(): OrbCacheDatabase =
    Room.inMemoryDatabaseBuilder(ContextWrapper(null), OrbCacheDatabase::class.java)
        .setDriver(BundledSQLiteDriver())
        .setQueryCoroutineContext(Dispatchers.Unconfined)
        .build()

/** Room asks the Context where a named database lives; here the name already is the full path. */
private class PathContext : ContextWrapper(null) {
    override fun getDatabasePath(name: String): File = File(name)
}

/** A database file on disk (plain SQLite), for the factory tests. */
fun fileDb(file: File): OrbCacheDatabase =
    Room.databaseBuilder(PathContext(), OrbCacheDatabase::class.java, file.absolutePath)
        .setDriver(BundledSQLiteDriver())
        .setQueryCoroutineContext(Dispatchers.Unconfined)
        .build()

fun json(text: String): JsonElement = Json.parseToJsonElement(text)

val ONLINE = ConnectionState.Online("http://pc", "PC", PcVersions(4, 2, "3.8.4"))
val OFFLINE = ConnectionState.Offline(null, null)

/** One call the fake PC received: the method and its params. */
class Call(val method: String, val params: JsonObject) {
    val clientId get() = (params["clientId"] as JsonPrimitive).content
    val text get() = (params["text"] as JsonPrimitive).content
}

/** A PC that answers each call from a script; no network and no crypto. */
class FakePc(var answer: suspend (Call) -> Result<JsonElement> = { Result.success(JsonObject(emptyMap())) }) : PcCaller {
    val calls = ArrayList<Call>()
    override suspend fun call(method: String, params: JsonObject): Result<JsonElement> {
        val c = Call(method, params)
        calls += c
        return answer(c)
    }
    override fun supports(method: String) = true
}

fun failure(e: LinkError): Result<JsonElement> = Result.failure(LinkException(e))

fun apiOf(pc: FakePc) = OrbApi(pc)
