package ir.payamresan.bulk

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

/**
 * پل HTTP برای برنامهٔ ویندوز: همان قوانین CSV، همان صف، ارسال با سیم‌کارت گوشی.
 * HTTP bridge so the Windows app (PayamResan Desktop) can drive the phone over Wi-Fi.
 *
 * نکته: هیچ‌گاه روی اینترنت باز نکنید — فقط در شبکهٔ محلی/وای‌فای خانه.
 */
object Bridge {

    private var server: ServerSocket? = null
    private var thread: Thread? = null
    var token: String = ""
        private set
    var port: Int = 8765
        private set
    private lateinit var app: Context
    private var running = false

    fun start(context: Context, preferredPort: Int = 8765): String {
        if (running) return info()
        app = context.applicationContext
        Ctx.app = app
        token = tokenFile(app).let { f ->
            if (f.exists()) f.readText().trim() else randomToken().also { t -> f.writeText(t) }
        }
        var p = preferredPort
        var ss: ServerSocket? = null
        while (ss == null && p < preferredPort + 10) {
            ss = try { ServerSocket(p, 16, null) } catch (e: Exception) { null }
            if (ss == null) p++
        }
        if (ss == null) throw IllegalStateException("پورتی آزاد پیدا نشد")
        port = p
        server = ss
        running = true
        val t = Thread { acceptLoop(ss) }
        t.isBackground = true
        t.name = "bridge"
        thread = t
        t.start()
        return info()
    }

    fun stop() {
        running = false
        try { server?.close() } catch (e: Exception) {}
        server = null
        thread = null
    }

    fun info(): String {
        val ips = addresses()
        val urls = ips.map { "http://$it:$port" }.joinToString("\n")
        return "پل روشن است روی پورت $port\n$urls\nتوکن: $token"
    }

    private fun tokenFile(context: Context) = File(context.filesDir, "bridge-token.txt")

    private fun randomToken(): String {
        val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
        return (1..16).map { chars.random() }.joinToString("")
    }

    private fun addresses(): List<String> {
        val out = ArrayList<String>()
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                for (ia in ni.inetAddresses) {
                    if (!ia.isLoopbackAddress && ia is Inet4Address) out.add(ia.hostAddress ?: "")
                }
            }
        } catch (e: Exception) {}
        if (out.isEmpty()) out.add("127.0.0.1")
        return out
    }

    private fun acceptLoop(ss: ServerSocket) {
        while (running) {
            try {
                val s = ss.accept()
                Thread { handle(s) }.apply { isBackground = true }.start()
            } catch (e: Exception) {
                if (running) Thread.sleep(200)
            }
        }
    }

    // --------------------------------------------------------------- HTTP core

    private fun handle(socket: Socket) {
        try {
            socket.soTimeout = 120_000
            val input = BufferedInputStream(socket.getInputStream())
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val rawPath = parts[1]
            val headers = HashMap<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val i = line.indexOf(':')
                if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
            }
            val qIndex = rawPath.indexOf('?')
            val path = if (qIndex >= 0) rawPath.substring(0, qIndex) else rawPath
            val query = if (qIndex >= 0) parseQuery(rawPath.substring(qIndex + 1)) else HashMap()

            // احراز هویت (به‌جز /ping)
            val given = headers["x-api-token"] ?: query["token"] ?: ""
            if (path != "/ping" && given != token) {
                respond(socket, 401, "application/json", "{\"ok\":false,\"error\":\"توکن نامعتبر است\"}".toByteArray())
                return
            }

            when {
                path == "/ping" -> json(socket, 200, JSONObject().put("ok", true).put("app", "payamresan-android")
                    .put("rules", Rules.VERSION).put("quota_today", Quota.usedToday()).put("state", Engine.state.name))
                path == "/status" -> json(socket, 200, Engine.progress()
                    .put("sims", simsJson())
                    .put("rules_version", Rules.VERSION)
                    .put("rules", Rules.rulesJson()))
                path == "/rules" -> json(socket, 200, Rules.rulesJson())
                path == "/metrics" -> json(socket, 200, metricsJson())
                path == "/sims" -> json(socket, 200, JSONObject().put("sims", simsJson()))
                path == "/contacts" -> json(socket, 200, contactsJson())
                path == "/logs" -> json(socket, 200, logsJson())
                path == "/templates" -> json(socket, 200, JSONObject().put("samples", JSONArray().apply {
                    Templates.SAMPLES.forEach { put(JSONObject().put("name", it.first).put("text", it.second)) }
                }))
                path == "/inbox" -> json(socket, 200, Inbox.json(app, query["limit"]?.toIntOrNull() ?: 200))
                path == "/results" -> json(socket, 200, resultsJson())
                path == "/optout" -> json(socket, 200, JSONObject()
                    .put("ok", true)
                    .put("applied", Inbox.applyOptOuts(app, query["limit"]?.toIntOrNull() ?: 500))
                    .put("blacklist", JSONArray(blacklist(app).toList())))
                path.startsWith("/download") -> download(socket, query["name"] ?: "")
                method == "POST" && path == "/parse" -> {
                    val body = readBody(input, headers)
                    json(socket, 200, Rules.handleParse(app, body))
                }
                method == "POST" && path == "/send" -> {
                    val body = readBody(input, headers)
                    json(socket, 200, Rules.handleSend(app, body))
                }
                method == "POST" && path == "/send/start" -> {
                    Engine.start(app); SendService.ctl(app, SendService.ACTION_START)
                    json(socket, 200, JSONObject().put("ok", true).put("state", Engine.state.name))
                }
                method == "POST" && path == "/send/pause" -> {
                    if (Engine.state == Engine.State.PAUSED) Engine.resume() else Engine.pause()
                    json(socket, 200, JSONObject().put("ok", true).put("state", Engine.state.name))
                }
                method == "POST" && path == "/send/stop" -> {
                    Engine.stop(); Engine.saveState(app)
                    json(socket, 200, JSONObject().put("ok", true).put("state", Engine.state.name))
                }
                method == "POST" && path == "/quit" -> {
                    json(socket, 200, JSONObject().put("ok", true))
                    stop()
                }
                else -> json(socket, 404, JSONObject().put("ok", false).put("error", "مسیر ناشناخته: $path"))
            }
        } catch (e: Exception) {
            try { respond(socket, 500, "application/json", "{\"ok\":false,\"error\":\"${(e.message ?: "").replace("\"", "'")}\"}".toByteArray()) } catch (x: Exception) {}
        } finally {
            try { socket.close() } catch (e: Exception) {}
        }
    }

    private fun readBody(input: InputStream, headers: Map<String, String>): ByteArray {
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        if (len <= 0) return ByteArray(0)
        val buf = ByteArray(len)
        var read = 0
        while (read < len) {
            val n = input.read(buf, read, len - read)
            if (n <= 0) break
            read += n
        }
        return buf
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        var c = input.read()
        if (c < 0) return null
        while (c >= 0 && c != '\n'.code) {
            if (c != '\r'.code) sb.append(c.toChar())
            c = input.read()
        }
        return sb.toString()
    }

    private fun parseQuery(q: String): HashMap<String, String> {
        val m = HashMap<String, String>()
        for (pair in q.split("&")) {
            if (pair.isBlank()) continue
            val i = pair.indexOf('=')
            if (i > 0) m[URLDecoder.decode(pair.substring(0, i), "UTF-8")] = URLDecoder.decode(pair.substring(i + 1), "UTF-8")
        }
        return m
    }

    private fun json(socket: Socket, code: Int, obj: JSONObject) {
        respond(socket, code, "application/json; charset=utf-8", obj.toString().toByteArray(Charsets.UTF_8))
    }

    private fun respond(socket: Socket, code: Int, type: String, body: ByteArray) {
        val out: OutputStream = socket.getOutputStream()
        val header = StringBuilder()
        header.append("HTTP/1.1 $code ${if (code == 200) "OK" else "ERROR"}\r\n")
        header.append("Content-Type: $type\r\n")
        header.append("Content-Length: ${body.size}\r\n")
        header.append("Access-Control-Allow-Origin: *\r\n")
        header.append("Access-Control-Allow-Headers: Content-Type, X-Api-Token\r\n")
        header.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
        header.append("Connection: close\r\n\r\n")
        out.write(header.toString().toByteArray(Charsets.UTF_8))
        if (body.isNotEmpty()) out.write(body)
        out.flush()
    }

    private fun download(socket: Socket, name: String) {
        val safe = File(name).name
        val candidates = listOf(File(File(app.filesDir, "logs"), safe), File(File(app.getExternalFilesDir(null), "out"), safe))
        val f = candidates.firstOrNull { it.exists() && it.isFile }
        if (f == null) { json(socket, 404, JSONObject().put("ok", false).put("error", "فایل پیدا نشد")); return }
        respond(socket, 200, "text/csv; charset=utf-8", f.readBytes())
    }

    private fun simsJson(): JSONArray {
        val arr = JSONArray()
        for (s in Sms.sims(app)) {
            arr.put(JSONObject().put("subId", s.subId).put("slot", s.slot).put("name", s.name).put("carrier", s.carrier))
        }
        return arr
    }

    private fun metricsJson(): JSONObject {
        val days = Quota.history(app, 14)
        val arr = JSONArray()
        for ((d, n) in days) arr.put(JSONObject().put("date", d).put("sent", n))
        val all = JSONArray()
        for (c in Engine.contacts) {
            val o = c.toJson()
            o.put("operator", Rules.operatorOf(c.number) ?: "")
            all.put(o)
        }
        return JSONObject()
            .put("quota_today", Quota.usedToday())
            .put("quota_history", arr)
            .put("contacts", all)
            .put("state", Engine.progress())
    }

    private fun contactsJson(): JSONObject {
        val rep = Engine.report ?: return JSONObject().put("ok", true).put("contacts", JSONArray())
        return Contacts.reportToJson(rep, true).put("ok", true)
    }

    /** فقط مخاطبین رسیده به وضعیت پایانی (برای لاگ‌گیری برنامهٔ ویندوز). */
    private fun resultsJson(): JSONObject {
        val arr = JSONArray()
        for (c in Engine.contacts) {
            if (c.status == Status.PENDING || c.status == Status.SENDING) continue
            arr.put(c.toJson().put("operator", Rules.operatorOf(c.number) ?: ""))
        }
        return JSONObject()
            .put("ok", true)
            .put("count", arr.length())
            .put("results", arr)
            .put("state", Engine.progress())
    }

    private fun logsJson(): JSONObject {
        val arr = JSONArray()
        for (f in Log.files(app)) {
            arr.put(JSONObject().put("name", f.name).put("size", f.length()).put("modified", Time.format(f.lastModified())))
        }
        return JSONObject().put("logs", arr)
    }
}
