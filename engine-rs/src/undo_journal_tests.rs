use super::*;

#[test]
fn an_index_is_pushed_on_by_each_earlier_removal_at_or_before_it() {
    assert_eq!(original(&[], 7), 7);
    assert_eq!(original(&[3], 7), 8);
    assert_eq!(original(&[3, 5], 4), 6, "both removals stood before it");
    assert_eq!(
        original(&[3, 4], 3),
        5,
        "a removed neighbor moves it past both"
    );
    assert_eq!(original(&[9], 7), 7);
}

#[test]
fn removals_are_kept_in_order() {
    let mut gone = Vec::new();
    for at in [5, 2, 9, 3] {
        note_gone(&mut gone, at);
    }
    assert_eq!(gone, vec![2, 3, 5, 9]);
}

/// Reference calculation: each earlier removal moves the current index.
fn original_by_walking(gone: &[usize], now: usize) -> usize {
    gone.iter()
        .fold(now, |at, &g| if g <= at { at + 1 } else { at })
}

#[test]
fn original_binary_search_matches_the_reference_for_many_removal_sets() {
    // Fixed sequence: deterministic, repeatable coverage without a dependency.
    let mut seed: u64 = 0x2545_f491_4f6c_dd1d;
    let mut next = |below: usize| {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1);
        (seed >> 33) as usize % below
    };
    for _ in 0..500 {
        let len = next(40) + 1;
        let mut gone = Vec::new();
        for at in 0..len {
            if next(3) == 0 {
                gone.push(at);
            }
        }
        for now in 0..len + 2 {
            assert_eq!(
                original(&gone, now),
                original_by_walking(&gone, now),
                "{gone:?} at {now}"
            );
        }
    }
}

#[test]
fn original_handles_a_large_bulldoze_without_rescanning_each_removal() {
    // The original 3,750-tile case from the Codex finding.
    let gone: Vec<usize> = (0..3_750).collect();
    assert_eq!(original(&gone, 0), 3_750);
    assert_eq!(original(&gone, 10), 3_760);
    assert_eq!(original(&gone, 3_750), 7_500);
}
