import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    `maven-publish`
    kotlin("plugin.serialization")
}

group = "io.r2rpc"
version = "0.1.0"

android {
    namespace = "io.r2rpc.sdk"
    compileSdk = 36

    defaultConfig {
        minSdk = 21
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

dependencies {
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5:2.2.21")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

publishing {
    publications {
        register<MavenPublication>("release") {
            artifactId = "r2rpc-android"
            afterEvaluate {
                from(components["release"])
            }
            pom {
                name.set("R2RPC Android SDK")
                description.set(
                    "R2RPC Android/Kotlin device and caller SDK",
                )
                url.set("https://github.com/rezoch340/R2RPC")
                licenses {
                    license {
                        name.set("All Rights Reserved")
                        url.set(
                            "https://github.com/rezoch340/R2RPC/blob/main/LICENSE",
                        )
                        distribution.set("repo")
                    }
                }
                developers {
                    developer {
                        id.set("r2rpc-contributors")
                        name.set("R2RPC Contributors")
                        url.set("https://github.com/rezoch340/R2RPC")
                    }
                }
                scm {
                    connection.set(
                        "scm:git:https://github.com/rezoch340/R2RPC.git",
                    )
                    developerConnection.set(
                        "scm:git:ssh://git@github.com/rezoch340/R2RPC.git",
                    )
                    url.set("https://github.com/rezoch340/R2RPC")
                }
            }
        }
    }
}
