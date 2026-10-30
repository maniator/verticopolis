use super::*;
use crate::schedule::Schedule;

fn index_matches_positions(t: &Tower) {
    assert_eq!(t.transport_by_id.len(), t.transports.len());
    for (i, tr) in t.transports.iter().enumerate() {
        assert_eq!(t.transport_index(tr.id), Some(i), "shaft {}", tr.id);
        assert_eq!(t.get_transport(tr.id).map(|x| x.id), Some(tr.id));
    }
}

#[test]
fn transport_index_survives_add_remove_and_reindex() {
    let mut t = Tower::new();
    for x in 0..30 {
        assert!(t.place(Kind::Lobby, 1, x).ok);
    }
    for fl in 2..=3 {
        for x in 0..30 {
            assert!(t.place(Kind::Floor, fl, x).ok);
        }
    }
    let mut ids = Vec::new();
    for x in [2, 10, 18] {
        let r = t.place_transport(Kind::ElevatorStandard, x, 1, 3);
        assert!(r.ok, "{:?}", r.reason);
        ids.push(r.unit_id.unwrap());
    }
    index_matches_positions(&t);
    assert!(t.remove_transport(ids[0]).is_some());
    assert_eq!(t.transport_index(ids[0]), None);
    index_matches_positions(&t);
    t.reindex();
    assert_eq!(t.transport_index(ids[0]), None);
    index_matches_positions(&t);
    assert_eq!(t.get_transport(ids[2]).map(|x| x.x), Some(18));
    // Removing the last shaft shifts nothing and must still drop its key.
    assert!(t.remove_transport(ids[2]).is_some());
    assert_eq!(t.transport_index(ids[2]), None);
    index_matches_positions(&t);
    assert_eq!(t.get_transport(ids[1]).map(|x| x.x), Some(10));
    // The loader assigns the vector directly and then calls `reindex`.
    let moved = std::mem::take(&mut t.transports);
    let mut fresh = Tower::new();
    fresh.transports = moved;
    fresh.reindex();
    index_matches_positions(&fresh);
    assert_eq!(fresh.get_transport(ids[1]).map(|x| x.x), Some(10));
}

fn scheduled_shaft(t: &mut Tower, cars: i64, weekday: Vec<i64>, weekend: Vec<i64>) -> i64 {
    for x in 0..30 {
        assert!(t.place(Kind::Lobby, 1, x).ok);
    }
    for x in 0..30 {
        assert!(t.place(Kind::Floor, 2, x).ok);
    }
    let r = t.place_transport(Kind::ElevatorStandard, 2, 1, 2);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    assert!(t.set_cars(id, cars) || cars == 1);
    t.transports[0].schedule = Some(Schedule {
        weekday: Some(weekday),
        weekend: Some(weekend),
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: Some(vec![1, 2]),
    });
    id
}

fn rows(t: &Tower) -> (Vec<i64>, Vec<i64>) {
    let s = t.transports[0].schedule.as_ref().unwrap();
    (s.weekday.clone().unwrap(), s.weekend.clone().unwrap())
}

#[test]
fn a_bought_car_runs_in_every_hour_that_ran_the_whole_fleet() {
    let mut t = Tower::new();
    let id = scheduled_shaft(&mut t, 1, vec![1; 24], vec![1; 24]);
    assert!(t.set_cars(id, 2));
    assert_eq!(rows(&t), (vec![2; 24], vec![2; 24]));
    assert!(t.set_cars(id, 4));
    assert_eq!(rows(&t), (vec![4; 24], vec![4; 24]));
}

#[test]
fn a_bought_car_keeps_cut_back_hours_and_the_day_types_apart() {
    let mut t = Tower::new();
    let night = |full: i64| -> Vec<i64> {
        (0..24)
            .map(|h| {
                if h < 6 {
                    0
                } else if h < 9 {
                    1
                } else {
                    full
                }
            })
            .collect()
    };
    let id = scheduled_shaft(&mut t, 3, night(3), vec![1; 24]);
    assert!(t.set_cars(id, 4));
    assert_eq!(rows(&t), (night(4), vec![1; 24]));
    // The staging is untouched, and a shrink clamps the rows.
    assert_eq!(
        t.transports[0].schedule.as_ref().unwrap().home_floors,
        Some(vec![1, 2])
    );
    assert!(t.set_cars(id, 2));
    assert_eq!(rows(&t).1, vec![1; 24]);
    assert!(rows(&t).0.iter().all(|&n| n <= 2));
}
