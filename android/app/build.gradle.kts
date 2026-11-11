plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    // Same package as the 3.8.1 (Tauri) app so this one installs over it and keeps its link (decided by the owner on 2026-11-11).
    namespace = "dev.orb.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.orb.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 3008004
        versionName = "3.8.4"
    }

    buildTypes {
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
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    // No okhttp-sse on purpose: it hides SSE comments, and the silence watchdog must count the PC's ": ping" lines.
    implementation(libs.okhttp)
    implementation(libs.tink.android)
    // Only org.bouncycastle.crypto.generators.SCrypt is used (Android has no scrypt); R8 strips the rest of the library.
    implementation(libs.bouncycastle.bcprov)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
