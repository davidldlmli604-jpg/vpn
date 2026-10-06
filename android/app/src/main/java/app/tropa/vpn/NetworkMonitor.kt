package app.tropa.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import io.nekohasekai.libbox.InterfaceUpdateListener
import java.net.NetworkInterface

/**
 * Следит за «основной» сетью телефона (Wi-Fi, мобильный интернет) и сообщает о ней движку: через неё он
 * ходит к серверу. При переключении Wi-Fi ↔ мобильный движок сам переподключается.
 */
object NetworkMonitor {
    @Volatile var defaultNetwork: Network? = null
        private set
    private var listener: InterfaceUpdateListener? = null
    private var callback: ConnectivityManager.NetworkCallback? = null

    private fun cm(): ConnectivityManager = TropaApp.app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun start() {
        if (callback != null) return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { defaultNetwork = network; notifyListener() }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { if (defaultNetwork != network) { defaultNetwork = network; notifyListener() } }
            override fun onLinkPropertiesChanged(network: Network, lp: android.net.LinkProperties) { if (defaultNetwork == network) notifyListener() }
            override fun onLost(network: Network) { if (defaultNetwork == network) { defaultNetwork = null; notifyListener() } }
        }
        callback = cb
        // Основная сеть телефона (как в официальном приложении sing-box): начиная с Android 9 «сеть по умолчанию»
        // для VPN-приложения — это сам VPN, поэтому сеть запрашивается явно
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
            .build()
        val handler = Handler(HandlerThread("tropa-network").apply { start() }.looper)
        when {
            Build.VERSION.SDK_INT >= 31 -> cm().registerBestMatchingNetworkCallback(request, cb, handler)
            Build.VERSION.SDK_INT >= 28 -> cm().requestNetwork(request, cb, handler)
            else -> cm().registerDefaultNetworkCallback(cb, handler)
        }
        defaultNetwork = cm().activeNetwork
    }

    fun stop() {
        callback?.let { runCatching { cm().unregisterNetworkCallback(it) } }
        callback = null
        defaultNetwork = null
    }

    fun setListener(l: InterfaceUpdateListener?) {
        listener = l
        notifyListener()
    }

    private fun notifyListener() {
        val l = listener ?: return
        val network = defaultNetwork
        if (network == null) {
            l.updateDefaultInterface("", -1, false, false)
            return
        }
        repeat(10) {
            val lp = cm().getLinkProperties(network)
            val name = lp?.interfaceName
            if (name != null) {
                val index = runCatching { NetworkInterface.getByName(name).index }.getOrNull()
                if (index != null) {
                    l.updateDefaultInterface(name, index, false, false)
                    return
                }
            }
            Thread.sleep(100)
        }
    }
}
