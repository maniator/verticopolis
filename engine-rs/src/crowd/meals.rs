//! Port of `crowd/meals.ts`.

use crate::facilities::Kind;
use crate::rules::HousekeepingShift;
use crate::tower::Unit;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MealWindow {
    Breakfast,
    Lunch,
    Dinner,
    LateNight,
}

impl MealWindow {
    pub fn bounds(self) -> (i64, i64) {
        match self {
            MealWindow::Breakfast => (6, 9),
            MealWindow::Lunch => (11, 14),
            MealWindow::Dinner => (17, 20),
            MealWindow::LateNight => (21, 24),
        }
    }

    pub fn venues(self) -> &'static [Kind] {
        match self {
            MealWindow::Breakfast => &[Kind::FastFood],
            MealWindow::Lunch | MealWindow::Dinner => {
                &[Kind::FastFood, Kind::Restaurant, Kind::FoodHall]
            }
            MealWindow::LateNight => &[Kind::FastFood, Kind::Cinema],
        }
    }

    /// `MEAL_MIX[window].origins`.
    pub fn origins(self) -> &'static [MealOrigin] {
        match self {
            MealWindow::Breakfast => &[MealOrigin::Hotel, MealOrigin::Condo, MealOrigin::Staff],
            MealWindow::Lunch | MealWindow::Dinner => &[
                MealOrigin::Office,
                MealOrigin::Condo,
                MealOrigin::Hotel,
                MealOrigin::Staff,
            ],
            MealWindow::LateNight => &[MealOrigin::Hotel, MealOrigin::Condo],
        }
    }
}

pub fn meal_window_for(hour: i64) -> Option<MealWindow> {
    for w in [
        MealWindow::Breakfast,
        MealWindow::Lunch,
        MealWindow::Dinner,
        MealWindow::LateNight,
    ] {
        let (s, e) = w.bounds();
        if hour >= s && hour < e {
            return Some(w);
        }
    }
    None
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MealOrigin {
    Office,
    Condo,
    Hotel,
    Staff,
}

impl MealOrigin {
    /// `ECON.mealPopulationWeights`.
    pub fn weight(self) -> f64 {
        match self {
            MealOrigin::Condo => 0.3,
            _ => 1.0,
        }
    }
}

/// `staffOnShift`.
pub fn staff_on_shift(kind: Kind, hour: i64, shift: HousekeepingShift) -> bool {
    if kind == Kind::Housekeeping {
        return hour >= shift.start && hour < shift.end;
    }
    true
}

/// `matchesMealOriginKind`.
pub fn matches_meal_origin_kind(u: &Unit, bucket: MealOrigin) -> bool {
    match bucket {
        MealOrigin::Office => u.kind == Kind::Office,
        MealOrigin::Condo => u.kind == Kind::Condo || u.kind.is_rental(),
        MealOrigin::Hotel => u.kind.is_hotel(),
        MealOrigin::Staff => u.kind.is_staff_kind(),
    }
}

/// `outboundWeight`.
pub fn outbound_weight(t: f64) -> f64 {
    (2.0 * (0.6 - t)).clamp(0.0, 1.0)
}
