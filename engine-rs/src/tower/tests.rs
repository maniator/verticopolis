use super::*;

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
