allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
// 일부 플러그인(flutter_blue_plus 1.x 등)이 낮은 compileSdk(33)로 빌드되는데, 함께 끌려오는 androidx 라이브러리는 34 이상을 요구한다.
// 플러그인 라이브러리 모듈의 compileSdk 를 앱과 같은 36 으로 올린다(앱의 targetSdk·minSdk 와 무관, 하위 호환).
subprojects {
    afterEvaluate {
        if (plugins.hasPlugin("com.android.library")) {
            // AGP 클래스를 루트 빌드 스크립트에서 직접 참조하지 않도록 Groovy 속성 접근으로 바꾼다
            val android = extensions.getByName("android")
            val current = org.codehaus.groovy.runtime.InvokerHelper.getProperty(android, "compileSdk") as Int?
            if ((current ?: 0) < 36) org.codehaus.groovy.runtime.InvokerHelper.setProperty(android, "compileSdk", 36)
        }
    }
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
