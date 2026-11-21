import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Play 업로드 키(Play 앱 서명 사용). android/key.properties 는 PC 에만 두고 저장소에 올리지 않는다(.gitignore).
// 파일이 없으면 release 도 디버그 키로 서명한다(사내 테스트 APK). 단, Play 업로드용 AAB 는 키 없이 만들지 않는다.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) FileInputStream(keystorePropertiesFile).use { load(it) }
}
val hasUploadKey = keystorePropertiesFile.exists()
if (!hasUploadKey && gradle.startParameter.taskNames.any { it.contains("bundleRelease", ignoreCase = true) }) {
    throw GradleException("android/key.properties 가 없어 Play 업로드용 AAB 를 만들 수 없습니다. README 의 'Play 스토어 배포' 절차로 업로드 키를 먼저 만드세요.")
}

android {
    namespace = "kr.pedaleye.pedaleye_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Play 스토어 등록 후에는 바꿀 수 없다
        applicationId = "kr.pedaleye.pedaleye_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // flutter_secure_storage 11 이 Android 7.0(API 24) 이상을 요구한다
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (hasUploadKey) "upload" else "debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
