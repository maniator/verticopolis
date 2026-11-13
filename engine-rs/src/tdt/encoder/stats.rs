//! What the encode pass answers besides the bytes.

/// Numbers the report reads from the encode pass (`EncodeStats`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EncodeStats {
    pub balance: i64,
    pub money: f64,
    pub star: i64,
    pub shafts_dropped: i64,
    pub shafts_colliding: i64,
    pub flights_dropped: i64,
    pub transports_dropped: i64,
    pub elevators_len: i64,
    pub walkways_len: i64,
    pub express_len: i64,
}

pub struct EncodeResult {
    pub bytes: Vec<u8>,
    pub stats: EncodeStats,
}
