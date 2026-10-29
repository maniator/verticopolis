use super::*;
use sha2::{Digest, Sha256};
use std::io::Read;

/// The inputs, from a seeded xorshift32. Each expected length and SHA-256
/// is what fflate 0.8.3 writes for the same bytes:
/// `deflateSync(gen(kind, len, seed), { level: 1 })` with this generator
/// written in JavaScript (`x ^= x << 13; x ^= x >>> 17; x ^= x << 5`, all
/// unsigned).
fn gen(kind: &str, len: usize, seed: u32) -> Vec<u8> {
    let mut x = seed;
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        x
    };
    let mut out = Vec::with_capacity(len);
    while out.len() < len {
        match kind {
            "zero" => out.push(0),
            "a" => out.push(b'a'),
            "rand" => out.push(next() as u8),
            "acgt" => out.push(b"ACGT"[(next() & 3) as usize]),
            "mixed" => {
                let b = if next() % 4 == 0 {
                    next() as u8
                } else {
                    b"abcdefgh"[(next() & 7) as usize]
                };
                out.push(b);
            }
            "runs" => {
                let b = next() as u8;
                let mut n = next() % 300;
                while n > 0 && out.len() < len {
                    out.push(b);
                    n -= 1;
                }
            }
            "geo" => {
                let mut k = 0u8;
                while k < 40 && next() % 1000 < 618 {
                    k += 1;
                }
                out.push(0x20 + k);
            }
            _ => unreachable!(),
        }
    }
    out
}

const VECTORS: &[(&str, usize, u32, usize, &str)] = &[
    (
        "zero",
        0,
        1,
        2,
        "9b4fb24edd6d1d8830e272398263cdbf026b97392cc35387b991dc0248a628f9",
    ),
    (
        "a",
        1,
        1,
        3,
        "59fced9a2ff83dabdd7055cf3abd6c12b802e6397b6fba5b8251cdf95d2bc991",
    ),
    (
        "mixed",
        2,
        3,
        4,
        "686a3e27361ae5436199fbc29c8b197d57e02c0680ac29a4959759aecf3309e7",
    ),
    (
        "mixed",
        3,
        4,
        5,
        "4c88b591c08cf183996884e4be8f6e6b526b6d9413e467a9bbc1da022be6ae80",
    ),
    (
        "a",
        100000,
        1,
        114,
        "30848518b27ec0b484826fe274f17fb0dd7c8cd8295b069350cf422f97ad99af",
    ),
    (
        "zero",
        2000000,
        1,
        1966,
        "4f699e0e219ee0f4a12b21db2248732d7b706e13ace75c5836782fb18637fcd9",
    ),
    (
        "rand",
        1000,
        5,
        1005,
        "a8d3561d13495a1b25aee3d685eee843fd0e2518884a01a7b7386a3a606cda92",
    ),
    (
        "rand",
        70000,
        6,
        70015,
        "80ba365a9c60fb6409cafc7bfa472a15316ea4517bb90b4da9a2d07bd5ee1b40",
    ),
    (
        "acgt",
        300000,
        7,
        97616,
        "bdefaadb5949e6d09095ec7a62e55ab6ac82f7aa13df6eeea5e30cb8d1f7219e",
    ),
    (
        "runs",
        500000,
        8,
        10774,
        "e20be8e4cd4665eb17a0f2b9453c931f03efc0713705089e02d3a3ef1868eb69",
    ),
    (
        "geo",
        200000,
        9,
        84435,
        "d4e83206a9e4c08bcd7be542131265155c24aef4345717e5c8b16de4c5c161d1",
    ),
    (
        "geo",
        3000,
        10,
        1270,
        "30ec3caafed77d3460e156fabb2ee7ea499d6f83a6f5284d0b496c0d88cfe7c8",
    ),
    // Either side of each length where the hash table size changes.
    (
        "mixed",
        2980,
        100,
        2093,
        "d671e404fb3097a3e4dc99611b902717e53058151704f98dd55615bcb3417b81",
    ),
    (
        "mixed",
        2982,
        101,
        2132,
        "0bb543dccec86eba44139826f8694b4ffb12b4e0d2d0d089ad369a0a3ef61a7b",
    ),
    (
        "mixed",
        8102,
        102,
        5785,
        "c73d857b0bfddeef6846bb13537dbb6182eede8eb0b77b6b5dfab558a8438a60",
    ),
    (
        "mixed",
        8104,
        103,
        5789,
        "92dbbe8b9655423cc062034a0204d77681c12011da0815985d1480d5848dd7f6",
    ),
    (
        "mixed",
        22025,
        104,
        15686,
        "d7c3a1c6fb6b65e2fc0fa499edcae8f153be41739b42f238a4d4763580f53973",
    ),
    (
        "mixed",
        22027,
        105,
        15869,
        "da1e41c3c207e3c1f4c0dbfd89b5d3de4f231dacc2e4f6fe839597868d252994",
    ),
    (
        "mixed",
        59873,
        106,
        42821,
        "f84c8bd0c7f9e9ae909f485ad207ebc92b6a2aab4aef245b1f3861c58657438c",
    ),
    (
        "mixed",
        59875,
        107,
        42919,
        "ac56fb42bd004e0f49d308cf2b09983523515276880583e3ed53992f649b9a78",
    ),
    (
        "mixed",
        162754,
        108,
        116772,
        "889fb816e40a141fb7835fca4214f79a3b6aa67c56d08090f4808991da6f50c7",
    ),
    (
        "mixed",
        162756,
        109,
        116579,
        "088f8f795c95f60c61d664cff026bd1ad549bd38640cc8cde0b1ec05754c39a9",
    ),
    (
        "mixed",
        442412,
        110,
        317596,
        "bada325caae7259b1ae0e0e573b9c6405fcb07d158dabe289982d614979e1045",
    ),
    (
        "mixed",
        442414,
        111,
        317378,
        "01ff9dee7076e6c47d00d201e73f926369ad7ac59461a7c2b890c26dfdcffa2b",
    ),
    // Saves the size of real towers and larger: many blocks of each kind.
    (
        "mixed",
        3000000,
        200,
        2153220,
        "61301f0298d3a86cc133e1eb31d8bbc346b5d1ef8ff7754892b5d65a2502a581",
    ),
    (
        "acgt",
        2500000,
        201,
        813144,
        "fceb046d78f239db20b4f5bb32bd47279a6c872ec4a69406748114f61b7d04db",
    ),
    (
        "geo",
        1000000,
        202,
        422441,
        "a8e4e3de05d238141b614575e059c92396e16cc7a1098adb2ef17423bebac3de",
    ),
];

#[test]
fn writes_what_fflate_writes() {
    for &(kind, len, seed, out_len, sha) in VECTORS {
        let dat = gen(kind, len, seed);
        let z = deflate_level1(&dat);
        let hex: String = Sha256::digest(&z)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!((z.len(), hex.as_str()), (out_len, sha), "{kind} {len}");
        let mut back = Vec::new();
        flate2::read::DeflateDecoder::new(&z[..])
            .read_to_end(&mut back)
            .unwrap();
        assert!(back == dat, "{kind} {len}: does not inflate back");
    }
}
