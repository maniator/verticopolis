use super::*;

fn step(label: &str) -> Step {
    Step {
        label: label.to_owned(),
        units: Vec::new(),
        transports: Vec::new(),
        money: 0.0,
        vip_visit_day: None,
        caps_held: Vec::new(),
    }
}

#[test]
fn a_kept_step_is_the_newest_undo_step() {
    let mut h = UndoHistory::default();
    h.keep(step("Bulldoze"));
    assert_eq!(h.depths(), (1, 0));
    assert_eq!(h.pop_undo().unwrap().label, "Bulldoze");
    assert!(h.pop_undo().is_none());
}

#[test]
fn a_new_step_ends_the_redo_trail() {
    let mut h = UndoHistory::default();
    h.push_redo(step("later"));
    h.keep(step("Bulldoze"));
    assert_eq!(h.depths(), (1, 0));
}

#[test]
fn each_stack_keeps_the_last_fifty_steps() {
    let mut h = UndoHistory::default();
    for n in 0..UNDO_CAP + 10 {
        h.keep(step(&format!("edit {n}")));
    }
    assert_eq!(h.depths().0, UNDO_CAP);
    assert_eq!(
        h.pop_undo().unwrap().label,
        format!("edit {}", UNDO_CAP + 9)
    );
    for n in 0..UNDO_CAP + 10 {
        h.push_redo(step(&format!("redo {n}")));
    }
    assert_eq!(h.depths().1, UNDO_CAP);
    let mut oldest = String::new();
    while let Some(s) = h.pop_redo() {
        oldest = s.label;
    }
    assert_eq!(oldest, "redo 10", "the oldest steps were dropped");
}

#[test]
fn clear_forgets_both_stacks() {
    let mut h = UndoHistory::default();
    h.keep(step("a"));
    h.push_redo(step("b"));
    h.clear();
    assert_eq!(h.depths(), (0, 0));
}
