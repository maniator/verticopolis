//! Port of `src/engine/Clock.ts` and `src/engine/calendar.ts`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarKind {
    Canon,
    RealWorld,
}

impl CalendarKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CalendarKind::Canon => "canon",
            CalendarKind::RealWorld => "realWorld",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Calendar {
    pub kind: CalendarKind,
    pub week_days: i64,
    pub weekend_days: i64,
    pub quarter_days: i64,
    pub year_days: i64,
    pub maint_period_days: i64,
}

pub const CANON: Calendar = Calendar {
    kind: CalendarKind::Canon,
    week_days: 3,
    weekend_days: 1,
    quarter_days: 3,
    year_days: 12,
    maint_period_days: 3,
};

pub const REAL_WORLD: Calendar = Calendar {
    kind: CalendarKind::RealWorld,
    week_days: 7,
    weekend_days: 2,
    quarter_days: 90,
    year_days: 360,
    maint_period_days: 30,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameMode {
    Classic,
    Modern,
}

impl GameMode {
    pub fn as_str(self) -> &'static str {
        match self {
            GameMode::Classic => "classic",
            GameMode::Modern => "modern",
        }
    }
}

/// Classic always runs canon; Modern honors the player's choice.
pub fn resolve_calendar(mode: GameMode, modern_calendar: CalendarKind) -> Calendar {
    if mode == GameMode::Classic {
        return CANON;
    }
    match modern_calendar {
        CalendarKind::Canon => CANON,
        CalendarKind::RealWorld => REAL_WORLD,
    }
}

#[derive(Clone, Debug)]
pub struct Clock {
    /// Game minutes since day 0 00:00. Fractional mid-step.
    pub minutes: f64,
    pub calendar: Calendar,
}

impl Clock {
    /// `new Clock(minutes, calendar)`: a literal 0 starts at 07:00 on day 0.
    pub fn new(minutes: f64, calendar: Calendar) -> Clock {
        Clock {
            minutes: if minutes == 0.0 { 7.0 * 60.0 } else { minutes },
            calendar,
        }
    }

    pub fn advance(&mut self, min: f64) {
        self.minutes += min;
    }

    pub fn minute_of_day(&self) -> f64 {
        ((self.minutes % 1440.0) + 1440.0) % 1440.0
    }

    pub fn hour(&self) -> i64 {
        (self.minute_of_day() / 60.0).floor() as i64
    }

    pub fn minute(&self) -> i64 {
        (self.minute_of_day() % 60.0).floor() as i64
    }

    pub fn day(&self) -> i64 {
        (self.minutes / 1440.0).floor() as i64
    }

    pub fn day_of_week(&self) -> i64 {
        self.day() % self.calendar.week_days
    }

    pub fn is_weekend(&self) -> bool {
        self.day_of_week() >= self.calendar.week_days - self.calendar.weekend_days
    }

    pub fn quarter(&self) -> i64 {
        ((self.day() % self.calendar.year_days) as f64 / self.calendar.quarter_days as f64).floor()
            as i64
    }

    pub fn year(&self) -> i64 {
        (self.day() as f64 / self.calendar.year_days as f64).floor() as i64
    }
}

impl Clock {
    pub fn is_morning(&self) -> bool {
        let h = self.hour();
        (7..10).contains(&h)
    }

    pub fn is_lunch(&self) -> bool {
        let h = self.hour();
        (11..14).contains(&h)
    }

    pub fn is_evening(&self) -> bool {
        let h = self.hour();
        (17..21).contains(&h)
    }

    pub fn is_night(&self) -> bool {
        let h = self.hour();
        !(6..21).contains(&h)
    }
}
