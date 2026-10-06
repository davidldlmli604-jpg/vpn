package app.tropa.vpn

import android.os.Handler
import android.os.Looper

/** Состояние VPN внутри приложения: его меняет служба, слушает окно (через TropaPlugin). */
object VpnState {
    @Volatile var status: String = "off" // off | connecting | on | disconnecting
        private set
    @Volatile var since: Long = 0
        private set
    @Volatile var lastError: String? = null
        private set

    /** Настройки движка для следующего запуска. Только в памяти: на диск в открытом виде не пишутся. */
    @Volatile var pendingConfig: String? = null
    @Volatile var serverName: String = ""

    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<(status: String, error: String?, revoked: Boolean) -> Unit>()

    fun listen(l: (String, String?, Boolean) -> Unit) {
        synchronized(listeners) { listeners.add(l) }
    }

    fun set(newStatus: String, error: String? = null, revoked: Boolean = false) {
        status = newStatus
        if (newStatus == "on") since = System.currentTimeMillis()
        if (newStatus == "off") since = 0
        lastError = error
        val copy = synchronized(listeners) { listeners.toList() }
        main.post { copy.forEach { it(newStatus, error, revoked) } }
    }
}
