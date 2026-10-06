package app.tropa.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import io.nekohasekai.libbox.BridgeOptions
import io.nekohasekai.libbox.BridgeSession
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.ConnectionOwner
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NeighborUpdateListener
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.PlatformUser
import io.nekohasekai.libbox.ShellSession
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.net.Inet6Address
import java.net.InterfaceAddress
import java.net.NetworkInterface
import io.nekohasekai.libbox.Notification as BoxNotification
import io.nekohasekai.libbox.NetworkInterface as BoxNetworkInterface

/**
 * Системная служба VPN. Android даёт ей «туннель» (весь трафик телефона), а движок sing-box решает, что пустить
 * через сервер, а что напрямую. Устроено по образцу официального приложения sing-box для Android.
 */
class TropaVpnService : VpnService(), PlatformInterface, CommandServerHandler {
    companion object {
        const val ACTION_START = "app.tropa.vpn.START"
        const val ACTION_STOP = "app.tropa.vpn.STOP"
        private const val CHANNEL = "vpn"
        private const val NOTIFICATION_ID = 1
    }

    private var commandServer: CommandServer? = null
    private var tun: ParcelFileDescriptor? = null
    @Volatile private var stopping = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopVpn(null, false)
            else -> startVpn()
        }
        return START_NOT_STICKY
    }

    private fun startVpn() {
        val config = VpnState.pendingConfig
        showNotification(getString(R.string.vpn_connecting))
        if (config == null) {
            stopVpn("no config", false)
            return
        }
        if (VpnState.status == "on" || VpnState.status == "connecting") return
        stopping = false
        VpnState.set("connecting")
        Thread start@{
            try {
                NetworkMonitor.start()
                val server = commandServer ?: CommandServer(this, this).also {
                    it.start()
                    commandServer = it
                }
                server.startOrReloadService(config, OverrideOptions())
                if (stopping) return@start
                Traffic.reset()
                VpnState.set("on")
                showNotification(getString(R.string.vpn_on, VpnState.serverName))
            } catch (e: Exception) {
                stopVpn(e.message ?: e.toString(), false)
            }
        }.start()
    }

    @Synchronized
    private fun stopVpn(error: String?, revoked: Boolean) {
        if (stopping && VpnState.status == "off") return
        stopping = true
        if (VpnState.status != "off") VpnState.set("disconnecting")
        Thread {
            runCatching { commandServer?.closeService() }
            runCatching { commandServer?.close() }
            commandServer = null
            runCatching { tun?.close() }
            tun = null
            NetworkMonitor.stop()
            VpnState.set("off", error, revoked)
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }.start()
    }

    override fun onRevoke() {
        // разрешение на VPN забрали (например, включили другое VPN-приложение)
        stopVpn(null, true)
    }

    override fun onDestroy() {
        if (VpnState.status != "off") stopVpn(null, false)
        super.onDestroy()
    }

    // ------------------------------------------------------------------ уведомление (без него Android выключит службу)

    private fun showNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.vpn_channel), NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, TropaVpnService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vpn)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .addAction(0, getString(R.string.vpn_stop), stop)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
    }

    // ------------------------------------------------------------------ CommandServerHandler

    override fun serviceStop() = stopVpn(null, false)
    override fun serviceReload() {}
    override fun getSystemProxyStatus(): SystemProxyStatus = SystemProxyStatus()
    override fun setSystemProxyEnabled(isEnabled: Boolean) {}
    override fun triggerNativeCrash() {}
    override fun writeDebugMessage(message: String?) {}
    override fun connectSSHAgent(): Int = -1

    // ------------------------------------------------------------------ PlatformInterface

    override fun localDNSTransport(): LocalDNSTransport = LocalResolver
    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true
    /** Свои соединения движка (к серверу) — мимо туннеля, иначе была бы петля. */
    override fun autoDetectInterfaceControl(fd: Int) { protect(fd) }

    override fun openTun(options: TunOptions): Int {
        if (prepare(this) != null) error("android: missing vpn permission")
        val b = Builder().setSession(getString(R.string.app_name)).setMtu(options.getMTU())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) b.setMetered(false)

        val v4 = options.getInet4Address()
        while (v4.hasNext()) { val a = v4.next(); b.addAddress(a.address(), a.prefix()) }
        val v6 = options.getInet6Address()
        while (v6.hasNext()) { val a = v6.next(); b.addAddress(a.address(), a.prefix()) }

        if (options.getAutoRoute()) {
            val dns = options.getDNSServerAddress()
            while (dns.hasNext()) b.addDnsServer(dns.next())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val r4 = options.getInet4RouteAddress()
                if (r4.hasNext()) while (r4.hasNext()) b.addRoute(r4.next().toIpPrefix())
                else if (options.getInet4Address().hasNext()) b.addRoute("0.0.0.0", 0)
                val r6 = options.getInet6RouteAddress()
                if (r6.hasNext()) while (r6.hasNext()) b.addRoute(r6.next().toIpPrefix())
                else if (options.getInet6Address().hasNext()) b.addRoute("::", 0)
                val x4 = options.getInet4RouteExcludeAddress()
                while (x4.hasNext()) b.excludeRoute(x4.next().toIpPrefix())
                val x6 = options.getInet6RouteExcludeAddress()
                while (x6.hasNext()) b.excludeRoute(x6.next().toIpPrefix())
            } else {
                val r4 = options.getInet4RouteRange()
                while (r4.hasNext()) { val a = r4.next(); b.addRoute(a.address(), a.prefix()) }
                val r6 = options.getInet6RouteRange()
                while (r6.hasNext()) { val a = r6.next(); b.addRoute(a.address(), a.prefix()) }
            }
            val inc = options.getIncludePackage()
            while (inc.hasNext()) runCatching { b.addAllowedApplication(inc.next()) }
            val exc = options.getExcludePackage()
            while (exc.hasNext()) runCatching { b.addDisallowedApplication(exc.next()) }
        }
        val pfd = b.establish() ?: error("android: the application is not prepared or is revoked")
        tun = pfd
        return pfd.fd
    }

    override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

    override fun findConnectionOwner(ipProtocol: Int, sourceAddress: String, sourcePort: Int, destinationAddress: String, destinationPort: Int): ConnectionOwner {
        error("not supported")
    }

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = NetworkMonitor.setListener(listener)
    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = NetworkMonitor.setListener(null)

    override fun getInterfaces(): NetworkInterfaceIterator {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val all = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        val list = mutableListOf<BoxNetworkInterface>()
        @Suppress("DEPRECATION")
        for (network in cm.allNetworks) {
            val lp = cm.getLinkProperties(network) ?: continue
            val caps = cm.getNetworkCapabilities(network) ?: continue
            val ni = all.find { it.name == lp.interfaceName } ?: continue
            val box = BoxNetworkInterface()
            box.name = lp.interfaceName
            box.index = ni.index
            box.dnsServer = StringArray(lp.dnsServers.mapNotNull { it.hostAddress }.iterator())
            box.type = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
                else -> Libbox.InterfaceTypeOther
            }
            runCatching { box.mtu = ni.mtu }
            box.addresses = StringArray(ni.interfaceAddresses.map { it.toPrefix() }.iterator())
            var f = 0
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) f = android.system.OsConstants.IFF_UP or android.system.OsConstants.IFF_RUNNING
            if (ni.isLoopback) f = f or android.system.OsConstants.IFF_LOOPBACK
            if (ni.isPointToPoint) f = f or android.system.OsConstants.IFF_POINTOPOINT
            if (ni.supportsMulticast()) f = f or android.system.OsConstants.IFF_MULTICAST
            box.flags = f
            box.metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            list.add(box)
        }
        return InterfaceArray(list.iterator())
    }

    override fun underNetworkExtension(): Boolean = false
    override fun includeAllNetworks(): Boolean = false
    override fun readWIFIState(): WIFIState? = null
    override fun clearDNSCache() {}
    override fun sendNotification(notification: BoxNotification) {}
    override fun cancelNotification(identifier: String, typeID: Int) {}
    override fun startNeighborMonitor(listener: NeighborUpdateListener?) {}
    override fun closeNeighborMonitor(listener: NeighborUpdateListener?) {}
    override fun registerMyInterface(name: String?) {}
    override fun usePlatformShell(): Boolean = false
    override fun checkPlatformShell() { error("not supported") }
    override fun openShellSession(user: PlatformUser?, command: String?, environ: StringIterator?, term: String?, rows: Int, cols: Int): ShellSession = error("not supported")
    override fun lookupUser(username: String?): PlatformUser = error("not supported")
    override fun lookupSFTPServer(): String = error("not supported")
    override fun readSystemSSHHostKey(): String = error("not supported")
    override fun tailscaleHostname(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
    override fun usePlatformBridge(): Boolean = false
    override fun createBridge(options: BridgeOptions?): BridgeSession = error("not supported")

    // ------------------------------------------------------------------ мелкие помощники

    private class InterfaceArray(private val it: Iterator<BoxNetworkInterface>) : NetworkInterfaceIterator {
        override fun hasNext(): Boolean = it.hasNext()
        override fun next(): BoxNetworkInterface = it.next()
    }

    class StringArray(private val it: Iterator<String>) : StringIterator {
        override fun len(): Int = 0
        override fun hasNext(): Boolean = it.hasNext()
        override fun next(): String = it.next()
    }

    private fun InterfaceAddress.toPrefix(): String =
        if (address is Inet6Address) "${Inet6Address.getByAddress(address.address).hostAddress}/$networkPrefixLength"
        else "${address.hostAddress}/$networkPrefixLength"

    @androidx.annotation.RequiresApi(33)
    private fun io.nekohasekai.libbox.RoutePrefix.toIpPrefix() = android.net.IpPrefix(java.net.InetAddress.getByName(address()), prefix())
}

/** Сколько данных прошло с момента включения (по счётчикам Android для нашего приложения). */
object Traffic {
    private var tx0 = 0L
    private var rx0 = 0L
    fun reset() {
        tx0 = android.net.TrafficStats.getUidTxBytes(Process.myUid()).coerceAtLeast(0)
        rx0 = android.net.TrafficStats.getUidRxBytes(Process.myUid()).coerceAtLeast(0)
    }
    fun tx(): Long = (android.net.TrafficStats.getUidTxBytes(Process.myUid()) - tx0).coerceAtLeast(0)
    fun rx(): Long = (android.net.TrafficStats.getUidRxBytes(Process.myUid()) - rx0).coerceAtLeast(0)
}
