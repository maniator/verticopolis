//! Mulberry32, a port of `src/engine/rng.ts`. The TypeScript keeps the state
//! as a signed 32-bit integer through `| 0` and `Math.imul`; wrapping u32
//! arithmetic produces the same bits.

#[derive(Clone, Debug)]
pub struct Rng {
    state: u32,
    /// The seed this stream was constructed with, fixed for its whole life.
    pub initial_seed: u32,
}

impl Rng {
    /// `new RNG(seed)`: `state = seed >>> 0 || 1`.
    pub fn new(seed: u32) -> Rng {
        Rng {
            state: if seed == 0 { 1 } else { seed },
            initial_seed: seed,
        }
    }

    /// Float in `[0, 1)`.
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let s = self.state;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }

    /// Integer in `[min, max]` inclusive.
    pub fn int(&mut self, min: i64, max: i64) -> i64 {
        min + (self.next() * ((max - min + 1) as f64)).floor() as i64
    }

    /// True with probability `p`.
    pub fn chance(&mut self, p: f64) -> bool {
        self.next() < p
    }

    /// One element of `arr`, by `Math.floor(next() * arr.length)`.
    pub fn pick<'a, T>(&mut self, arr: &'a [T]) -> &'a T {
        &arr[(self.next() * arr.len() as f64).floor() as usize]
    }

    /// The live state as `state >>> 0`.
    pub fn seed(&self) -> u32 {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_four(seed: u32) -> (Vec<f64>, u32) {
        let mut r = Rng::new(seed);
        let v: Vec<f64> = (0..4).map(|_| r.next()).collect();
        (v, r.seed())
    }

    #[test]
    fn matches_node_bit_for_bit() {
        assert_eq!(
            first_four(12345),
            (
                vec![
                    0.9797282677609473,
                    0.3067522644996643,
                    0.484205421525985,
                    0.817934412509203
                ],
                3031308301
            )
        );
        assert_eq!(
            first_four(0),
            (
                vec![
                    0.6270739405881613,
                    0.002735721180215478,
                    0.5274470399599522,
                    0.9810509674716741
                ],
                3031295957
            )
        );
        assert_eq!(
            first_four(4294967295),
            (
                vec![
                    0.8964226141106337,
                    0.189478256739676,
                    0.7156526781618595,
                    0.9440599093213677
                ],
                3031295955
            )
        );
        assert_eq!(
            first_four(20260713),
            (
                vec![
                    0.3828057593200356,
                    0.14615820185281336,
                    0.8997327252291143,
                    0.8929723014589399
                ],
                3051556669
            )
        );
    }

    #[test]
    fn int_matches_node() {
        assert_eq!(Rng::new(12345).int(0, 3000), 2940);
        assert_eq!(Rng::new(0).int(0, 3000), 1881);
        assert_eq!(Rng::new(4294967295).int(0, 3000), 2690);
        assert_eq!(Rng::new(20260713).int(0, 3000), 1148);
    }
}
