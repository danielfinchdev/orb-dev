plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
}

room {
    // Committed so a schema change always comes with its migration.
    schemaDirectory("$projectDir/schemas")
}

android {
    // Same package as the 3.8.1 (Tauri) app so this one installs over it and keeps its link (decided by the owner on 2026-11-11).
    namespace = "dev.orb.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.orb.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 3008007
        versionName = "3.8.7"
        // The only native code is SQLCipher: arm64 for phones, x86_64 for the emulator (debug only).
        ndk { abiFilters += "arm64-v8a" }
    }

    buildTypes {
        debug {
            // Installs next to the daily app (dev.orb.app) so the two never share data or keys.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            ndk { abiFilters += "x86_64" }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // No signingConfig on purpose: releases are signed outside this project.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        // The Room tests build a database on the JVM; the android.jar stubs must not throw for the Context they pass.
        unitTests.isReturnDefaultValues = true
        // Robolectric runs the Compose UI tests on the JVM and needs the merged resources and manifest.
        unitTests.isIncludeAndroidResources = true
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.fragment)
    // WebViewAssetLoader: the local web pages (games, Pizarra) are served from the app's assets, never from the network.
    implementation(libs.androidx.webkit)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    // No okhttp-sse on purpose: it hides SSE comments, and the silence watchdog must count the PC's ": ping" lines.
    implementation(libs.okhttp)
    implementation(libs.tink.android)
    // Only org.bouncycastle.crypto.generators.SCrypt is used (Android has no scrypt); R8 strips the rest of the library.
    implementation(libs.bouncycastle.bcprov)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.androidx.sqlite)
    // Whole-database encryption; wired into Room through its SupportSQLite open helper factory.
    implementation(libs.sqlcipher.android)

    testImplementation(libs.androidx.sqlite.bundled)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(platform(libs.compose.bom))
    debugImplementation(libs.compose.ui.test.manifest)
}
