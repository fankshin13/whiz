package kr.pedaleye.pedaleye_app

import android.media.AudioManager
import android.media.ToneGenerator
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    // 양발 동시 조작 경고음. 알림 음량으로 짧게 울린다.
    private var tone: ToneGenerator? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "kr.pedaleye/alert").setMethodCallHandler { call, result ->
            if (call.method != "beep") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            try {
                val generator = tone ?: ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80).also { tone = it }
                generator.startTone(ToneGenerator.TONE_PROP_BEEP2, 200)
                result.success(null)
            } catch (error: RuntimeException) {
                result.error("TONE_UNAVAILABLE", error.message, null)
            }
        }
    }

    override fun onDestroy() {
        tone?.release()
        tone = null
        super.onDestroy()
    }
}
