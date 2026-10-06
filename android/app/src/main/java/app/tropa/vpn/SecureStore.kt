package app.tropa.vpn

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Данные приложения (настройки, ключи серверов) хранятся в файле, зашифрованном ключом из хранилища Android
 * (Android Keystore). Сам ключ шифрования из хранилища не достаётся — ни другим приложениям, ни через резервную копию.
 */
class SecureStore(context: Context) {
    private val file = File(context.filesDir, "data.enc")
    private val alias = "tropa-data"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    /** Доступно ли шифрование системой. */
    fun available(): Boolean = runCatching { key(); true }.getOrDefault(false)

    class Broken : Exception("data broken")

    /** null — данных ещё нет. Broken — файл есть, но не расшифровывается (его откладываем в сторону). */
    fun load(): String? {
        if (!file.exists()) return null
        try {
            val bytes = file.readBytes()
            val iv = bytes.copyOfRange(0, 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            return String(cipher.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
        } catch (e: Exception) {
            file.renameTo(File(file.parentFile, "data.enc.broken-${System.currentTimeMillis()}"))
            throw Broken()
        }
    }

    @Synchronized
    fun save(text: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val out = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        val tmp = File(file.parentFile, "data.enc.tmp")
        tmp.writeBytes(out)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}
