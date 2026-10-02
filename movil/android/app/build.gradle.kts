plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cl.ersphoenix.phone"
    compileSdk = 34

    defaultConfig {
        applicationId = "cl.ersphoenix.phone"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0-direct-call"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
