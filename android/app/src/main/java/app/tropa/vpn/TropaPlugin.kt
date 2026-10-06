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
        val r: ScanIntentResult = ScanIntentResult.parseActivityResult(result.resultCode, result.data)
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
