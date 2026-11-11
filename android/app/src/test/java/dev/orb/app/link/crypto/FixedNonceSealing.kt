package dev.orb.app.link.crypto

import com.google.crypto.tink.aead.internal.InsecureNonceXChaCha20Poly1305

/**
 * Ciphertext (tag included, no nonce prefix) under a chosen nonce, to reproduce the PC's vectors byte for byte.
 * Reusing a nonce breaks the cipher, so this lives in the test sources only: production code never references it.
 */
internal fun sealWithNonce(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: String): ByteArray =
    InsecureNonceXChaCha20Poly1305(key).encrypt(nonce, plaintext, aad.toByteArray(Charsets.UTF_8))
