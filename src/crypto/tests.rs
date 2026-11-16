//! Unit tests for pure-Rust cryptographic primitives and password verification.

use super::*;

#[test]
fn test_sha256_known_vectors() {
    assert_eq!(
        hex_encode(&Sha256::digest(b"")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        hex_encode(&Sha256::digest(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        hex_encode(&Sha256::digest(
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        )),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}

#[test]
fn test_hmac_sha256_rfc4231() {
    let hmac1 = hmac_sha256(&[0x0bu8; 20], b"Hi There");
    assert_eq!(
        hex_encode(&hmac1),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );

    let hmac2 = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
    assert_eq!(
        hex_encode(&hmac2),
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
}

#[test]
fn test_pbkdf2_rfc6070_vectors() {
    let mut out1 = [0u8; 32];
    pbkdf2_hmac_sha256(b"password", b"salt", 1, &mut out1);
    assert_eq!(
        hex_encode(&out1),
        "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
    );

    let mut out2 = [0u8; 32];
    pbkdf2_hmac_sha256(b"password", b"salt", 2, &mut out2);
    assert_eq!(
        hex_encode(&out2),
        "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
    );

    let mut out4096 = [0u8; 32];
    pbkdf2_hmac_sha256(b"password", b"salt", 4096, &mut out4096);
    assert_eq!(
        hex_encode(&out4096),
        "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a"
    );
}

#[test]
fn test_cross_backend_pbkdf2_vector() {
    // Vector verified against Cloudflare Workers Web Crypto API.
    let salt = "212bf7469384adf25dd7172c6da62c56";
    let hash = hash_password("Password123!", salt).unwrap();
    assert_eq!(
        hash,
        "4cf93f29c9f5f198b130302240eb21dbaa25f01fa5de875a50dc6ecb7e4d749c"
    );
    assert!(verify_password("Password123!", salt, &hash));
    assert!(!verify_password("WrongPassword!", salt, &hash));
}

#[test]
fn test_constant_time_equality() {
    assert!(constant_time_eq_str("abcdef", "abcdef"));
    assert!(!constant_time_eq_str("abcdef", "abcdeg"));
    assert!(!constant_time_eq_str("abcdef", "abcde"));
    assert!(!constant_time_eq_str("", "a"));
    assert!(constant_time_eq_str("", ""));
}

#[test]
fn test_random_salt_generation() {
    let s1 = random_salt();
    let s2 = random_salt();
    assert_ne!(s1, [0u8; 16]);
    assert_ne!(s1, s2);
    assert_eq!(s1.len(), 16);

    let hex = random_salt_hex();
    assert_eq!(hex.len(), 32);
    assert!(hex_decode(&hex).is_some());
}
