package app.tropa.vpn

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions
import io.nekohasekai.libbox.Libbox

/**
 * Мост между окном (общий интерфейс «Тропы», src/mobile/native.ts) и Android: VPN, шифрование данных,
 * буфер обмена, камера для QR-кода.
 */
@CapacitorPlugin(name = "Tropa")
class TropaPlugin : Plugin() {
    private val store by lazy { SecureStore(context) }

    override fun load() {
        VpnState.listen { status, error, revoked ->
            val o = JSObject()
            o.put("status", status)
            if (error != null) o.put("error", error)
            if (revoked) o.put("revoked", true)
            notifyListeners("status", o)
        }
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val o = JSObject()
        val pi = context.packageManager.getPackageInfo(context.packageName, 0)
        o.put("version", pi.versionName ?: "")
        o.put("engineVersion", runCatching { Libbox.version() }.getOrDefault(""))
        o.put("secure", store.available())
        call.resolve(o)
    }

    @PluginMethod
    fun loadData(call: PluginCall) {
        val o = JSObject()
        try {
            o.put("text", store.load())
        } catch (e: SecureStore.Broken) {
            o.put("text", null as String?)
            o.put("broken", true)
        }
        call.resolve(o)
    }

    @PluginMethod
    fun saveData(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("no text")
        try {
            store.save(text)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "save failed")
        }
    }

    @PluginMethod
    fun readClipboard(call: PluginCall) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
        call.resolve(JSObject().put("text", text))
    }

    @PluginMethod
    fun writeClipboard(call: PluginCall) {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Тропа", call.getString("text") ?: ""))
        call.resolve()
    }

    // ---------------------------------------------------------------- сеть: подписка и задержка

    /**
     * Загрузка подписки средствами Android (не WebView): так нет ограничений браузера, работают и http-ссылки,
     * а при ошибке понятно, что именно случилось (code: timeout | dns | tls | cleartext | too-large | network).
     */
    @PluginMethod
    fun httpGet(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("no url", "bad-url")
        val ua = call.getString("userAgent") ?: "Tropa"
        val timeout = call.getInt("timeoutMs") ?: 20000
        val maxBytes = call.getInt("maxBytes") ?: (6 * 1024 * 1024)
        Thread fetch@{
            try {
                var current = java.net.URL(url)
                var conn: java.net.HttpURLConnection
                var hops = 0
                while (true) {
                    conn = (current.openConnection() as java.net.HttpURLConnection).apply {
                        connectTimeout = timeout
                        readTimeout = timeout
                        instanceFollowRedirects = false
                        setRequestProperty("User-Agent", ua)
                        setRequestProperty("Accept", "*/*")
                    }
                    val code = conn.responseCode
                    if (code in 300..399 && hops < 5) {
                        val loc = conn.getHeaderField("Location") ?: break
                        current = java.net.URL(current, loc)
                        conn.disconnect()
                        hops++
                        continue
                    }
                    break
                }
                val status = conn.responseCode
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val out = java.io.ByteArrayOutputStream()
                stream?.use { input ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > maxBytes) {
                            conn.disconnect()
                            call.reject("too large", "too-large")
                            return@fetch
                        }
                    }
                }
                val headers = JSObject()
                for ((k, v) in conn.headerFields) if (k != null && v.isNotEmpty()) headers.put(k.lowercase(), v[0])
                conn.disconnect()
                val o = JSObject()
                o.put("status", status)
                o.put("body", out.toString("UTF-8"))
                o.put("headers", headers)
                call.resolve(o)
            } catch (e: java.net.SocketTimeoutException) {
                call.reject(e.toString(), "timeout")
            } catch (e: java.net.UnknownHostException) {
                call.reject(e.toString(), "dns")
            } catch (e: javax.net.ssl.SSLException) {
                call.reject(e.toString(), "tls")
            } catch (e: java.net.MalformedURLException) {
                call.reject(e.toString(), "bad-url")
            } catch (e: Exception) {
                val code = if (e.toString().contains("Cleartext", ignoreCase = true)) "cleartext" else "network"
                call.reject(e.toString(), code)
            }
        }.start()
    }

    /**
     * Задержка до сервера: сколько миллисекунд занимает установка соединения с ним. Пока работает VPN —
     * через основную сеть телефона (мимо туннеля), чтобы мерить именно путь до сервера.
     */
    @PluginMethod
    fun tcpPing(call: PluginCall) {
        val host = call.getString("host") ?: return call.reject("no host")
        val port = call.getInt("port") ?: return call.reject("no port")
        val timeout = call.getInt("timeoutMs") ?: 4000
        Thread {
            val socket = java.net.Socket()
            try {
                val network = NetworkMonitor.defaultNetwork
                val address = if (network != null) {
                    network.bindSocket(socket)
                    network.getByName(host)
                } else {
                    java.net.InetAddress.getByName(host)
                }
                val t0 = System.nanoTime()
                socket.connect(java.net.InetSocketAddress(address, port), timeout)
                val ms = (System.nanoTime() - t0) / 1_000_000
                call.resolve(JSObject().put("ms", ms))
            } catch (e: Exception) {
                call.resolve(JSObject().put("error", e.toString()))
            } finally {
                runCatching { socket.close() }
            }
        }.start()
    }

    // ---------------------------------------------------------------- QR-код

    @PluginMethod
    fun scanQr(call: PluginCall) {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Наведите камеру на QR-код ключа")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
        val intent = ScanContract().createIntent(context, options)
        startActivityForResult(call, intent, "onScan")
    }

    @ActivityCallback
    private fun onScan(call: PluginCall?, result: ActivityResult) {
        call ?: return
        val r: ScanIntentResult = ScanContract().parseResult(result.resultCode, result.data)
        val o = JSObject()
        o.put("text", r.contents)
        if (r.contents == null && ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) o.put("denied", true)
        call.resolve(o)
    }

    // ---------------------------------------------------------------- VPN

    @PluginMethod
    fun start(call: PluginCall) {
        val config = call.getString("config") ?: return call.reject("no config")
        VpnState.pendingConfig = config
        VpnState.serverName = call.getString("serverName") ?: ""
        val consent = VpnService.prepare(context)
        if (consent != null) {
            // Android один раз спрашивает разрешение на VPN
            startActivityForResult(call, consent, "onConsent")
            return
        }
        launch()
        call.resolve(JSObject().put("consent", true))
    }

    @ActivityCallback
    private fun onConsent(call: PluginCall?, result: ActivityResult) {
        call ?: return
        if (result.resultCode == Activity.RESULT_OK) {
            launch()
            call.resolve(JSObject().put("consent", true))
        } else {
            VpnState.pendingConfig = null
            call.resolve(JSObject().put("consent", false))
        }
    }

    private fun launch() {
        val i = Intent(context, TropaVpnService::class.java).setAction(TropaVpnService.ACTION_START)
        ContextCompat.startForegroundService(context, i)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        if (VpnState.status == "off") {
            call.resolve()
            return
        }
        context.startService(Intent(context, TropaVpnService::class.java).setAction(TropaVpnService.ACTION_STOP))
        call.resolve()
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val o = JSObject()
        o.put("status", VpnState.status)
        if (VpnState.since > 0) o.put("since", VpnState.since)
        call.resolve(o)
    }

    @PluginMethod
    fun stats(call: PluginCall) {
        call.resolve(JSObject().put("tx", Traffic.tx()).put("rx", Traffic.rx()))
    }
}
