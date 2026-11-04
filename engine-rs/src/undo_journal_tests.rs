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
    for at in [5, 2, 9, 2] {
        note_gone(&mut gone, at);
    }
    assert_eq!(gone, vec![2, 2, 5, 9]);
}
