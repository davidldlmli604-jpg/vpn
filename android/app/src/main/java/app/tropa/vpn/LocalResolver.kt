package app.tropa.vpn

import android.net.DnsResolver
import android.os.Build
import android.os.CancellationSignal
import android.system.ErrnoException
import io.nekohasekai.libbox.ExchangeContext
import io.nekohasekai.libbox.LocalDNSTransport
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * «Системный» DNS для движка: на Android обычного файла настроек DNS нет, поэтому прямые запросы
 * (российские сайты, адрес самого сервера) движок задаёт через системный распознаватель основной сети.
 * По образцу официального приложения sing-box.
 */
object LocalResolver : LocalDNSTransport {
    private const val RCODE_NXDOMAIN = 3
    private val executor = Executors.newCachedThreadPool()

    override fun raw(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    override fun exchange(ctx: ExchangeContext, message: ByteArray) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) error("raw dns not supported")
        val network = NetworkMonitor.defaultNetwork ?: error("missing default interface")
        val done = CountDownLatch(1)
        val signal = CancellationSignal()
        ctx.onCancel { signal.cancel(); done.countDown() }
        DnsResolver.getInstance().rawQuery(network, message, DnsResolver.FLAG_NO_RETRY, executor, signal, object : DnsResolver.Callback<ByteArray> {
            override fun onAnswer(answer: ByteArray, rcode: Int) {
                if (rcode == 0) ctx.rawSuccess(answer) else ctx.errorCode(rcode)
                done.countDown()
            }
            override fun onError(error: DnsResolver.DnsException) {
                val cause = error.cause
                if (cause is ErrnoException) ctx.errnoCode(cause.errno) else ctx.errorCode(2)
                done.countDown()
            }
        })
        done.await(15, TimeUnit.SECONDS)
    }

    override fun lookup(ctx: ExchangeContext, network: String, domain: String) {
        val net = NetworkMonitor.defaultNetwork ?: error("missing default interface")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val done = CountDownLatch(1)
            val signal = CancellationSignal()
            ctx.onCancel { signal.cancel(); done.countDown() }
            val cb = object : DnsResolver.Callback<List<InetAddress>> {
                override fun onAnswer(answer: List<InetAddress>, rcode: Int) {
                    if (rcode == 0) ctx.success(answer.mapNotNull { it.hostAddress }.joinToString("\n")) else ctx.errorCode(rcode)
                    done.countDown()
                }
                override fun onError(error: DnsResolver.DnsException) {
                    val cause = error.cause
                    if (cause is ErrnoException) ctx.errnoCode(cause.errno) else ctx.errorCode(2)
                    done.countDown()
                }
            }
            val type = when {
                network.endsWith("4") -> DnsResolver.TYPE_A
                network.endsWith("6") -> DnsResolver.TYPE_AAAA
                else -> null
            }
            if (type != null) DnsResolver.getInstance().query(net, domain, type, DnsResolver.FLAG_NO_RETRY, executor, signal, cb)
            else DnsResolver.getInstance().query(net, domain, DnsResolver.FLAG_NO_RETRY, executor, signal, cb)
            done.await(15, TimeUnit.SECONDS)
        } else {
            val answer = try {
                net.getAllByName(domain)
            } catch (e: UnknownHostException) {
                ctx.errorCode(RCODE_NXDOMAIN)
                return
            }
            ctx.success(answer.mapNotNull { it.hostAddress }.joinToString("\n"))
        }
    }
}
