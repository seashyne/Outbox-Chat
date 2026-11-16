//! SHA-256, HMAC-SHA256, and PBKDF2-HMAC-SHA256 primitives.
//!
//! Zero-external-dependency implementations compliant with FIPS 180-4,
//! RFC 2104 / RFC 4231, and RFC 2898 / RFC 6070.

/// SHA-256 round constants (first 32 bits of fractional parts of cube roots of first 64 primes).
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
];

/// Initial SHA-256 hash state values.
const H_INIT: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
];

#[inline(always)]
fn ch(x: u32, y: u32, z: u32) -> u32 {
    (x & y) ^ (!x & z)
}

#[inline(always)]
fn maj(x: u32, y: u32, z: u32) -> u32 {
    (x & y) ^ (x & z) ^ (y & z)
}

#[inline(always)]
fn big_sigma0(x: u32) -> u32 {
    x.rotate_right(2) ^ x.rotate_right(13) ^ x.rotate_right(22)
}

#[inline(always)]
fn big_sigma1(x: u32) -> u32 {
    x.rotate_right(6) ^ x.rotate_right(11) ^ x.rotate_right(25)
}

#[inline(always)]
fn small_sigma0(x: u32) -> u32 {
    x.rotate_right(7) ^ x.rotate_right(18) ^ (x >> 3)
}

#[inline(always)]
fn small_sigma1(x: u32) -> u32 {
    x.rotate_right(17) ^ x.rotate_right(19) ^ (x >> 10)
}

/// Compress a single 64-byte block into the SHA-256 state.
#[inline(always)]
fn compress_block(state: &mut [u32; 8], block: &[u8; 64]) {
    let mut w = [0u32; 64];
    for i in 0..16 {
        w[i] = u32::from_be_bytes([
            block[i * 4],
            block[i * 4 + 1],
            block[i * 4 + 2],
            block[i * 4 + 3],
        ]);
    }
    for i in 16..64 {
        w[i] = small_sigma1(w[i - 2])
            .wrapping_add(w[i - 7])
            .wrapping_add(small_sigma0(w[i - 15]))
            .wrapping_add(w[i - 16]);
    }

    let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
    for i in 0..64 {
        let t1 = h
            .wrapping_add(big_sigma1(e))
            .wrapping_add(ch(e, f, g))
            .wrapping_add(K[i])
            .wrapping_add(w[i]);
        let t2 = big_sigma0(a).wrapping_add(maj(a, b, c));
        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(t1);
        d = c;
        c = b;
        b = a;
        a = t1.wrapping_add(t2);
    }

    for (idx, val) in [a, b, c, d, e, f, g, h].into_iter().enumerate() {
        state[idx] = state[idx].wrapping_add(val);
    }
}

/// Streaming SHA-256 hasher.
#[derive(Clone, Debug)]
pub struct Sha256 {
    state: [u32; 8],
    buffer: [u8; 64],
    buffer_len: usize,
    total_len: u64,
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha256 {
    /// Creates a new SHA-256 hasher initialized to FIPS 180-4 constants.
    pub fn new() -> Self {
        Self {
            state: H_INIT,
            buffer: [0u8; 64],
            buffer_len: 0,
            total_len: 0,
        }
    }

    /// Feeds arbitrary bytes into the hash state.
    pub fn update(&mut self, mut data: &[u8]) {
        self.total_len += data.len() as u64;
        if self.buffer_len > 0 {
            let to_copy = (64 - self.buffer_len).min(data.len());
            self.buffer[self.buffer_len..self.buffer_len + to_copy]
                .copy_from_slice(&data[..to_copy]);
            self.buffer_len += to_copy;
            data = &data[to_copy..];
            if self.buffer_len == 64 {
                let block = self.buffer;
                compress_block(&mut self.state, &block);
                self.buffer_len = 0;
            }
        }
        while data.len() >= 64 {
            let mut block = [0u8; 64];
            block.copy_from_slice(&data[..64]);
            compress_block(&mut self.state, &block);
            data = &data[64..];
        }
        if !data.is_empty() {
            self.buffer[..data.len()].copy_from_slice(data);
            self.buffer_len = data.len();
        }
    }

    /// Applies padding and returns the 32-byte digest.
    pub fn finalize(mut self) -> [u8; 32] {
        let bit_len = self.total_len * 8;
        self.buffer[self.buffer_len] = 0x80;
        self.buffer_len += 1;

        if self.buffer_len > 56 {
            self.buffer[self.buffer_len..64].fill(0);
            let block = self.buffer;
            compress_block(&mut self.state, &block);
            self.buffer = [0u8; 64];
            self.buffer_len = 0;
        }
        self.buffer[self.buffer_len..56].fill(0);
        self.buffer[56..64].copy_from_slice(&bit_len.to_be_bytes());
        let block = self.buffer;
        compress_block(&mut self.state, &block);

        let mut out = [0u8; 32];
        for (i, word) in self.state.iter().enumerate() {
            out[i * 4..(i + 1) * 4].copy_from_slice(&word.to_be_bytes());
        }
        out
    }

    /// Computes a one-shot SHA-256 digest of `data`.
    pub fn digest(data: &[u8]) -> [u8; 32] {
        let mut hasher = Self::new();
        hasher.update(data);
        hasher.finalize()
    }
}

/// Computes a one-shot HMAC-SHA256 tag.
#[allow(dead_code)]
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    HmacSha256::new(key).compute(data)
}

/// Reusable HMAC-SHA256 state pre-seeded with inner and outer padded keys.
/// Caching `ipad_hasher` and `opad_hasher` avoids recomputing key blocks across PBKDF2 iterations.
#[derive(Clone, Debug)]
pub struct HmacSha256 {
    ipad_hasher: Sha256,
    opad_hasher: Sha256,
}

impl HmacSha256 {
    /// Initializes an HMAC-SHA256 instance from `key`.
    pub fn new(key: &[u8]) -> Self {
        let mut key_pad = [0u8; 64];
        if key.len() > 64 {
            key_pad[..32].copy_from_slice(&Sha256::digest(key));
        } else {
            key_pad[..key.len()].copy_from_slice(key);
        }
        let mut ipad = [0u8; 64];
        let mut opad = [0u8; 64];
        for i in 0..64 {
            ipad[i] = key_pad[i] ^ 0x36;
            opad[i] = key_pad[i] ^ 0x5c;
        }
        let mut ipad_hasher = Sha256::new();
        ipad_hasher.update(&ipad);
        let mut opad_hasher = Sha256::new();
        opad_hasher.update(&opad);
        Self { ipad_hasher, opad_hasher }
    }

    /// Computes the HMAC tag for `data`.
    #[inline(always)]
    pub fn compute(&self, data: &[u8]) -> [u8; 32] {
        let mut inner = self.ipad_hasher.clone();
        inner.update(data);
        let inner_hash = inner.finalize();

        let mut outer = self.opad_hasher.clone();
        outer.update(&inner_hash);
        outer.finalize()
    }
}

/// Derives `out.len()` bytes using PBKDF2-HMAC-SHA256 (RFC 2898).
pub fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iterations: u32, out: &mut [u8]) {
    let prf = HmacSha256::new(password);
    let mut block_index = 1u32;
    let mut out_offset = 0;

    while out_offset < out.len() {
        let mut initial_data = Vec::with_capacity(salt.len() + 4);
        initial_data.extend_from_slice(salt);
        initial_data.extend_from_slice(&block_index.to_be_bytes());

        let mut u = prf.compute(&initial_data);
        let mut f = u;
        for _ in 1..iterations {
            u = prf.compute(&u);
            for i in 0..32 {
                f[i] ^= u[i];
            }
        }
        let to_copy = (out.len() - out_offset).min(32);
        out[out_offset..out_offset + to_copy].copy_from_slice(&f[..to_copy]);
        out_offset += to_copy;
        block_index += 1;
    }
}
