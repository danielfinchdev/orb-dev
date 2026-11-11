# Keep kotlinx.serialization generated serializers when release shrinking is enabled.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

# Bouncy Castle is used for SCrypt only. No keep rules on purpose: R8 removes the unused rest of the library, and
# nothing loads its provider classes by name.
-dontwarn org.bouncycastle.**

# OkHttp picks optional TLS providers by name when present; none of them is bundled.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
