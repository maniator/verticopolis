//! Port of `crowd/walk.ts`.

use super::{Person, WALK_SPEED};
use crate::jsmath;
use crate::tower::Tower;

/// Walk toward a tile x on the current floor; true once arrived.
pub fn walk_to(p: &mut Person, target_x: f64, dt: f64, tower: &Tower) -> bool {
    let dir = jsmath::sign(target_x - p.x);
    if dir != 0.0 {
        if let Some((start, end)) = tower.run_at(p.floor, jsmath::round(p.x) as i64) {
            if dir > 0.0 && target_x > end as f64 {
                p.x = end as f64;
                return true;
            }
            if dir < 0.0 && target_x < start as f64 {
                p.x = start as f64;
                return true;
            }
        }
    }
    let dx = target_x - p.x;
    let step = WALK_SPEED * dt;
    if dx.abs() <= step {
        p.x = target_x;
        return true;
    }
    p.x += dir * step;
    false
}
