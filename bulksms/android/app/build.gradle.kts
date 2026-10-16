plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ir.payamresan.bulk"
    compileSdk = 34

    defaultConfig {
        applicationId = "ir.payamresan.bulk"
        minSdk = 23
        targetSdk = 34
        versionCode = (project.findProperty("versionCodeIn") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionNameIn") as String?) ?: "1.0.0"
    }

    // امضای نسخهٔ release: اگر فایل کلید تنظیم شده باشد استفاده می‌شود، وگرنه کلید debug.
    signingConfigs {
        create("release") {
            val ks = System.getenv("RELEASE_STORE_FILE") ?: project.findProperty("RELEASE_STORE_FILE") as String?
            if (!ks.isNullOrBlank() && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("RELEASE_STORE_PASSWORD") ?: project.findProperty("RELEASE_STORE_PASSWORD") as String? ?: ""
                keyAlias = System.getenv("RELEASE_KEY_ALIAS") ?: project.findProperty("RELEASE_KEY_ALIAS") as String? ?: "payamresan"
                keyPassword = System.getenv("RELEASE_KEY_PASSWORD") ?: project.findProperty("RELEASE_KEY_PASSWORD") as String? ?: ""
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            isShrinkResources = false
            val ks = System.getenv("RELEASE_STORE_FILE")
            signingConfig = if (!ks.isNullOrBlank() && file(ks).exists()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        getByName("debug") {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module")
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
}
