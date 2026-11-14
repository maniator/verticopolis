//! The commute-stress averages: recording, seeding and the written rows.

use super::*;

#[test]
fn commute_stress_lists_each_floor_in_order() {
    let mut crowd = Crowd::new(1);
    assert_eq!(crowd.commute_stress_json(), json!([]));
    assert_eq!(crowd.commute_revision, 0);
    crowd.record_commute(7, 40.0);
    crowd.record_commute(3, 65.0);
    crowd.record_commute(7, 80.0);
    assert_eq!(crowd.commute_revision, 3);
    // The first sample seeds the average; the second moves it by the alpha.
    let seventh = 40.0 + (80.0 - 40.0) * COMMUTE_STRESS_ALPHA;
    assert_eq!(
        crowd.commute_stress_json(),
        json!([[3, 65.0], [7, seventh]])
    );
}

#[test]
fn seeding_replaces_the_averages_and_refuses_malformed_rows() {
    let mut crowd = Crowd::new(1);
    crowd.record_commute(9, 12.0);
    crowd
        .seed_commute_stress(&json!([[7, 40.5], [-1, 3.0]]))
        .expect("rows in the written shape seed");
    assert_eq!(crowd.commute_stress_json(), json!([[-1, 3.0], [7, 40.5]]));
    assert_eq!(
        crowd.commute_revision, 1,
        "seeding leaves the revision alone"
    );
    for bad in [
        json!({}),
        json!([[1]]),
        json!([[1.5, 2.0]]),
        json!([[1, "x"]]),
        json!([[1, 2.0], [1, 3.0]]),
    ] {
        assert!(crowd.seed_commute_stress(&bad).is_err(), "{bad}");
    }
    assert_eq!(
        crowd.commute_stress_json(),
        json!([[-1, 3.0], [7, 40.5]]),
        "a refusal changes nothing"
    );
}
