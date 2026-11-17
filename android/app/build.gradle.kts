import com.android.build.api.artifact.SingleArtifact
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Release signing: from environment variables in CI (the GitHub Actions secrets of
// .github/workflows/category-helper-release.yml) or from android/local.properties on the owner's
// machine. The keystore and its passwords never enter the repository. Without the keystore path,
// its password and the key alias there is no release signing config, and checkReleaseSigning stops
// every release build: the debug key is never used for a release.
val localProperties = Properties().apply {
    rootProject.file("local.properties").takeIf { it.isFile }?.inputStream()?.use { load(it) }
}

/** The environment variable first, then the local.properties key; trimmed, blank means missing. */
fun signingValue(env: String, property: String): String? =
    providers.environmentVariable(env).orNull?.trim()?.takeIf { it.isNotEmpty() }
        ?: localProperties.getProperty(property)?.trim()?.takeIf { it.isNotEmpty() }

val releaseKeystorePath = signingValue("DCH_KEYSTORE_PATH", "dch.keystore.path")
val releaseKeystorePassword = signingValue("DCH_KEYSTORE_PASSWORD", "dch.keystore.password")
val releaseKeyAlias = signingValue("DCH_KEY_ALIAS", "dch.key.alias")
// Optional: usually the same as the keystore password (keytool's PKCS12 keystores have only one)
val releaseKeyPassword = signingValue("DCH_KEY_PASSWORD", "dch.key.password") ?: releaseKeystorePassword
val missingReleaseSigning: List<String> = listOfNotNull(
    "DCH_KEYSTORE_PATH (dch.keystore.path)".takeIf { releaseKeystorePath == null },
    "DCH_KEYSTORE_PASSWORD (dch.keystore.password)".takeIf { releaseKeystorePassword == null },
    "DCH_KEY_ALIAS (dch.key.alias)".takeIf { releaseKeyAlias == null },
)
// A relative path is relative to android/, where local.properties is
val releaseKeystore: File? = releaseKeystorePath?.let { rootProject.file(it) }
// Where ./gradlew :app:releaseApk puts dokkants-category-helper.apk
val releaseDist: Provider<Directory> = layout.buildDirectory.dir("dist")

android {
    namespace = "it.emanuelemelini.dokkants.categoryhelper"
    compileSdk = 37

    defaultConfig {
        applicationId = "it.emanuelemelini.dokkants.categoryhelper"
        minSdk = 26
        targetSdk = 37
        versionCode = 7
        // 1.0.0: English UI (Italian translation), game ids in the dictionary, "Check for updates",
        // signed releases on GitHub
        // 1.1.0: automatic "Check for updates", at most once a day when Dokkan comes to the front
        versionName = "1.1.0"
    }

    signingConfigs {
        if (missingReleaseSigning.isEmpty()) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        // Debug builds install next to the release from GitHub: another id (.debug), "-debug" in the
        // version (also in the User-Agent of Check for updates), and in src/debug/res another name
        // ("(debug)", "CH debug" on the home screen) and another icon and bubble background.
        // Their data are separate from the release's.
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            // Null without the DCH_* signing values (and then checkReleaseSigning fails the build)
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

val checkReleaseSigning = tasks.register("checkReleaseSigning") {
    group = "verification"
    description = "Stops a release build when the DCH_* signing values are missing; clears build/dist first."
    val missing = missingReleaseSigning
    val keystore = releaseKeystore
    val dist = releaseDist
    destroyables.register(dist)
    doLast {
        // A release build that fails from here on never leaves the APK of an earlier build in build/dist
        dist.get().asFile.deleteRecursively()
        if (missing.isNotEmpty()) {
            throw GradleException(
                "Release signing is not configured: missing ${missing.joinToString()}. Set the dch.* keys in " +
                    "android/local.properties, or the DCH_* environment variables (see android/README.md, " +
                    "\"Il rilascio\"). A release is never signed with the debug key.",
            )
        }
        if (keystore != null && !keystore.isFile) {
            throw GradleException("DCH_KEYSTORE_PATH (dch.keystore.path) does not point to a file: $keystore")
        }
    }
}

// Every release build checks the signing first, before compiling anything
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(checkReleaseSigning) }

androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val apkDirectory = variant.artifacts.get(SingleArtifact.APK)
        // ./gradlew :app:releaseApk → app/build/dist/dokkants-category-helper.apk: the asset that
        // .github/workflows/category-helper-release.yml uploads to the GitHub release, under the
        // name the site links to (releases/latest/download/dokkants-category-helper.apk)
        tasks.register<Copy>("${variant.name}Apk") {
            group = "distribution"
            description = "Copies the signed release APK to build/dist/dokkants-category-helper.apk."
            dependsOn(checkReleaseSigning)
            from(apkDirectory) { include("*.apk") }
            into(releaseDist)
            rename { "dokkants-category-helper.apk" }
            // More than one APK (ABI or density splits) would collapse into one file: stop instead
            duplicatesStrategy = DuplicatesStrategy.FAIL
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.serialization.json)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
}
