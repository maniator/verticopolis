use super::seed_for;

#[test]
fn seed_matches_the_javascript_expression() {
    // Node: (id * 2654435761) | 0 for each id.
    assert_eq!(seed_for(1), -1640531535);
    assert_eq!(seed_for(2), 1013904226);
    assert_eq!(seed_for(3_400_000), -1911161536);
    assert_eq!(seed_for(10_000_000), -568160640);
}
