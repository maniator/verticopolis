use super::*;

/// The canon section of CLAUDE.md, stated as numbers so a "fix" to the
/// 1994 pooling or caps fails here before it reaches the referee.
#[test]
fn canon_caps_and_pools() {
    for (kind, cap) in [
        (Kind::Metro, 1),
        (Kind::WeddingHall, 1),
        (Kind::Security, 10),
        (Kind::Medical, 10),
        (Kind::Cinema, 16),
        (Kind::PartyHall, 16),
        (Kind::AquaticCenter, 8),
    ] {
        assert_eq!(build_cap(kind), Some(cap), "{kind:?}");
    }
    assert_eq!(build_cap(Kind::Office), None);
    // One 24-shaft pool for every elevator kind, express included.
    let shafts = &POOLED_CAPS[0];
    assert_eq!(shafts.cap, 24);
    assert_eq!(
        shafts.kinds,
        &[
            Kind::ElevatorStandard,
            Kind::ElevatorService,
            Kind::ElevatorExpress
        ]
    );
    // A separate 64-link pool for stairs and escalators.
    let links = &POOLED_CAPS[1];
    assert_eq!(links.cap, 64);
    assert_eq!(links.kinds, &[Kind::Stairs, Kind::Escalator]);
    // Eight cars per shaft for every elevator kind, service included.
    for kind in shafts.kinds {
        assert_eq!(kind.max_cars(), 8, "{kind:?}");
    }
    // Spans: standard and service 30 floors, express the whole tower,
    // stairs and escalators a fixed two floors (span 1).
    assert_eq!(Kind::ElevatorStandard.max_span(), 30);
    assert_eq!(Kind::ElevatorService.max_span(), 30);
    assert_eq!(Kind::ElevatorExpress.max_span(), MAX_FLOOR - MIN_FLOOR);
    assert_eq!(Kind::Stairs.max_span(), 1);
    assert_eq!(Kind::Escalator.max_span(), 1);
    assert!(Kind::Stairs.is_fixed_span() && Kind::Escalator.is_fixed_span());
    assert!(!Kind::ElevatorStandard.is_fixed_span());
}

#[test]
fn catalog_order() {
    for (i, f) in FACILITIES.iter().enumerate() {
        assert_eq!(f.kind as usize, i, "{} is out of Kind order", f.name);
    }
}
