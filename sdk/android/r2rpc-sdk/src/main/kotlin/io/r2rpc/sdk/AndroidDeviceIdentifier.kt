package io.r2rpc.sdk

import android.media.MediaDrm
import android.os.Build
import java.util.UUID

object AndroidDeviceIdentifier {
    private val widevineSchemeIdentifier =
        UUID.fromString("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")
    private val hexadecimalCharacters = "0123456789abcdef".toCharArray()
    private val cachedWidevineDeviceIdentifier by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        readWidevineMediaDrmIdentifier()
    }

    @JvmStatic
    fun fromWidevineMediaDrm(): String = cachedWidevineDeviceIdentifier

    private fun readWidevineMediaDrmIdentifier(): String {
        if (!MediaDrm.isCryptoSchemeSupported(widevineSchemeIdentifier)) {
            throw R2RpcDeviceIdentifierException(
                "当前 Android 设备不支持 Widevine MediaDrm，无法生成 clientId",
            )
        }

        val mediaDrm =
            try {
                MediaDrm(widevineSchemeIdentifier)
            } catch (exception: Exception) {
                throw R2RpcDeviceIdentifierException(
                    "无法初始化 Widevine MediaDrm",
                    exception,
                )
            }

        return try {
            encodeAsLowercaseHexadecimal(
                mediaDrm.getPropertyByteArray(MediaDrm.PROPERTY_DEVICE_UNIQUE_ID),
            )
        } catch (exception: Exception) {
            throw R2RpcDeviceIdentifierException(
                "无法读取 Widevine MediaDrm 设备 ID",
                exception,
            )
        } finally {
            release(mediaDrm)
        }
    }

    internal fun encodeAsLowercaseHexadecimal(identifierBytes: ByteArray): String {
        if (identifierBytes.isEmpty()) {
            throw R2RpcDeviceIdentifierException(
                "Widevine MediaDrm 设备 ID 不能为空",
            )
        }
        return buildString(identifierBytes.size * 2) {
            identifierBytes.forEach { identifierByte ->
                val unsignedByte = identifierByte.toInt() and 0xff
                append(hexadecimalCharacters[unsignedByte ushr 4])
                append(hexadecimalCharacters[unsignedByte and 0x0f])
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun release(mediaDrm: MediaDrm) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            mediaDrm.close()
        } else {
            mediaDrm.release()
        }
    }
}
