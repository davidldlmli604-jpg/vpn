package app.tropa.vpn

import android.app.Application
import android.os.Build
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.SetupOptions
import java.io.File

/** Запуск приложения: готовим движок sing-box (папки для его служебных файлов). */
class TropaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        app = this
        val work = File(filesDir, "engine").apply { mkdirs() }
        runCatching {
            Libbox.setup(SetupOptions().also {
                it.basePath = filesDir.path
                it.workingPath = work.path
                it.tempPath = cacheDir.path
                // обход ошибки Go на части версий Android (так же делает официальное приложение sing-box)
                it.fixAndroidStack = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                it.logMaxLines = 500
                it.debug = false
            })
        }
    }

    companion object {
        lateinit var app: TropaApp
    }
}
