//! Game time: the [`Clock`] on [`Simulation::clock`](crate::sim::Simulation::clock),
//! the [`GameMode`] a game is started in, and the two calendars.
//!
//! A game day is 1,440 game minutes. The canon calendar is the 1994
//! original's short one (a 3-day week with a 1-day weekend, 3-day quarters,
//! 12-day years); the real-world calendar has 7-day weeks, 90-day quarters
//! and 360-day years. Classic games always run canon.

/// Which calendar a game runs on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarKind {
    /// The 1994 original's short calendar ([`CANON`]).
    Canon,
    /// Weeks, quarters and years of real length ([`REAL_WORLD`]).
    RealWorld,
}

impl CalendarKind {
    /// The calendar a save or a host names, by its saved spelling.
    pub fn parse(s: &str) -> Option<CalendarKind> {
        match s {
            "canon" => Some(CalendarKind::Canon),
            "realWorld" => Some(CalendarKind::RealWorld),
            _ => None,
        }
    }

    /// The calendar's saved spelling: `canon` or `realWorld`.
    pub fn as_str(self) -> &'static str {
        match self {
            CalendarKind::Canon => "canon",
            CalendarKind::RealWorld => "realWorld",
        }
    }
}

/// The lengths a calendar gives the week, the quarter and the year, in days.
#[derive(Clone, Copy, Debug)]
pub struct Calendar {
    /// Which calendar this is.
    pub kind: CalendarKind,
    /// Days in a week, the weekend included.
    pub week_days: i64,
    /// Days at the end of each week that are the weekend.
    pub weekend_days: i64,
    /// Days in a quarter, when rent is collected.
    pub quarter_days: i64,
    /// Days in a year.
    pub year_days: i64,
    /// Days between maintenance bills.
    pub maint_period_days: i64,
}

/// The 1994 original's calendar, which Classic always runs.
pub const CANON: Calendar = Calendar {
    kind: CalendarKind::Canon,
    week_days: 3,
    weekend_days: 1,
    quarter_days: 3,
    year_days: 12,
    maint_period_days: 3,
};

/// The real-world calendar a Modern game may choose.
pub const REAL_WORLD: Calendar = Calendar {
    kind: CalendarKind::RealWorld,
    week_days: 7,
    weekend_days: 2,
    quarter_days: 90,
    year_days: 360,
    maint_period_days: 30,
};

/// The two ways to play, chosen when a game starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameMode {
    /// The 1994 original's rules, prices and limits.
    Classic,
    /// The original with quality-of-life changes and the calendar and
    /// bridging options. [`crate::catalog::catalog`] lists every difference
    /// a frontend shows.
    Modern,
}

impl GameMode {
    /// The mode's saved spelling: `classic` or `modern`.
    pub fn as_str(self) -> &'static str {
        match self {
            GameMode::Classic => "classic",
            GameMode::Modern => "modern",
        }
    }

    /// The mode a scenario or a host names, by its saved spelling.
    pub fn parse(s: &str) -> Option<GameMode> {
        match s {
            "classic" => Some(GameMode::Classic),
            "modern" => Some(GameMode::Modern),
            _ => None,
        }
    }
}

/// The calendar a game in `mode` runs: Classic always runs canon, and
/// Modern runs the one the player chose.
pub fn resolve_calendar(mode: GameMode, modern_calendar: CalendarKind) -> Calendar {
    if mode == GameMode::Classic {
        return CANON;
    }
    match modern_calendar {
        CalendarKind::Canon => CANON,
        CalendarKind::RealWorld => REAL_WORLD,
    }
}

/// The game clock.
#[derive(Clone, Debug)]
pub struct Clock {
    /// Game minutes since 00:00 on day 0. It can be fractional.
    pub minutes: f64,
    /// The calendar the game runs on.
    pub calendar: Calendar,
}

impl Clock {
    // `new Clock(minutes, calendar)`: a literal 0 starts at 07:00 on day 0.
    #[doc(hidden)]
    pub fn new(minutes: f64, calendar: Calendar) -> Clock {
        Clock {
            minutes: if minutes == 0.0 { 7.0 * 60.0 } else { minutes },
            calendar,
        }
    }

    #[doc(hidden)]
    pub fn advance(&mut self, min: f64) {
        self.minutes += min;
    }

    /// Minutes since midnight, 0 up to 1,440.
    pub fn minute_of_day(&self) -> f64 {
        ((self.minutes % 1440.0) + 1440.0) % 1440.0
    }

    /// The hour, 0 to 23.
    pub fn hour(&self) -> i64 {
        (self.minute_of_day() / 60.0).floor() as i64
    }

    /// The minute of the hour, 0 to 59.
    pub fn minute(&self) -> i64 {
        (self.minute_of_day() % 60.0).floor() as i64
    }

    /// The day number, counting from day 0.
    pub fn day(&self) -> i64 {
        (self.minutes / 1440.0).floor() as i64
    }

    /// The day of the week, from 0 to `week_days - 1`; the weekend is last.
    pub fn day_of_week(&self) -> i64 {
        self.day() % self.calendar.week_days
    }

    /// Whether today is a weekend day.
    pub fn is_weekend(&self) -> bool {
        self.is_weekend_on(self.day())
    }

    /// Whether `day` (a day number, as `day()` gives) falls on a weekend.
    pub fn is_weekend_on(&self, day: i64) -> bool {
        day.rem_euclid(self.calendar.week_days)
            >= self.calendar.week_days - self.calendar.weekend_days
    }

    /// The quarter of the year, from 0.
    pub fn quarter(&self) -> i64 {
        ((self.day() % self.calendar.year_days) as f64 / self.calendar.quarter_days as f64).floor()
            as i64
    }

    /// The year, counting from 0.
    pub fn year(&self) -> i64 {
        (self.day() as f64 / self.calendar.year_days as f64).floor() as i64
    }
}

impl Clock {
    /// 07:00 to 09:59, the morning rush.
    pub fn is_morning(&self) -> bool {
        let h = self.hour();
        (7..10).contains(&h)
    }

    /// 11:00 to 13:59, lunch.
    pub fn is_lunch(&self) -> bool {
        let h = self.hour();
        (11..14).contains(&h)
    }

    /// 17:00 to 20:59, the evening rush.
    pub fn is_evening(&self) -> bool {
        let h = self.hour();
        (17..21).contains(&h)
    }

    /// 21:00 to 05:59.
    pub fn is_night(&self) -> bool {
        let h = self.hour();
        !(6..21).contains(&h)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One reading of the clock on a calendar. The retired TypeScript engine
    /// held the same rows (`clockReadings.test.ts`, #1875).
    struct Row {
        name: &'static str,
        calendar: Calendar,
        minutes: f64,
        day: i64,
        day_of_week: i64,
        is_weekend: bool,
        quarter: i64,
        year: i64,
        hour: i64,
        minute: i64,
    }

    #[test]
    fn readings_match_the_web_table() {
        let rows = [
            Row {
                name: "canon, tower founded",
                calendar: CANON,
                minutes: 420.0,
                day: 0,
                day_of_week: 0,
                is_weekend: false,
                quarter: 0,
                year: 0,
                hour: 7,
                minute: 0,
            },
            Row {
                name: "canon, weekend slot",
                calendar: CANON,
                minutes: 3665.0,
                day: 2,
                day_of_week: 2,
                is_weekend: true,
                quarter: 0,
                year: 0,
                hour: 13,
                minute: 5,
            },
            Row {
                name: "canon, second quarter",
                calendar: CANON,
                minutes: 4380.0,
                day: 3,
                day_of_week: 0,
                is_weekend: false,
                quarter: 1,
                year: 0,
                hour: 1,
                minute: 0,
            },
            Row {
                name: "canon, year rollover",
                calendar: CANON,
                minutes: 17880.0,
                day: 12,
                day_of_week: 0,
                is_weekend: false,
                quarter: 0,
                year: 1,
                hour: 10,
                minute: 0,
            },
            Row {
                name: "canon, last day of the year",
                calendar: CANON,
                minutes: 17220.0,
                day: 11,
                day_of_week: 2,
                is_weekend: true,
                quarter: 3,
                year: 0,
                hour: 23,
                minute: 0,
            },
            Row {
                name: "real world, tower founded",
                calendar: REAL_WORLD,
                minutes: 420.0,
                day: 0,
                day_of_week: 0,
                is_weekend: false,
                quarter: 0,
                year: 0,
                hour: 7,
                minute: 0,
            },
            Row {
                name: "real world, first Saturday",
                calendar: REAL_WORLD,
                minutes: 7710.0,
                day: 5,
                day_of_week: 5,
                is_weekend: true,
                quarter: 0,
                year: 0,
                hour: 8,
                minute: 30,
            },
            Row {
                name: "real world, second quarter",
                calendar: REAL_WORLD,
                minutes: 129660.0,
                day: 90,
                day_of_week: 6,
                is_weekend: true,
                quarter: 1,
                year: 0,
                hour: 1,
                minute: 0,
            },
            Row {
                name: "real world, year rollover",
                calendar: REAL_WORLD,
                minutes: 519120.0,
                day: 360,
                day_of_week: 3,
                is_weekend: false,
                quarter: 0,
                year: 1,
                hour: 12,
                minute: 0,
            },
        ];
        for r in rows {
            let c = Clock::new(r.minutes, r.calendar);
            assert_eq!(c.day(), r.day, "{} day", r.name);
            assert_eq!(c.day_of_week(), r.day_of_week, "{} day of week", r.name);
            assert_eq!(c.is_weekend(), r.is_weekend, "{} weekend", r.name);
            assert_eq!(c.quarter(), r.quarter, "{} quarter", r.name);
            assert_eq!(c.year(), r.year, "{} year", r.name);
            assert_eq!(c.hour(), r.hour, "{} hour", r.name);
            assert_eq!(c.minute(), r.minute, "{} minute", r.name);
        }
    }

    #[test]
    fn calendar_spans_match_the_web() {
        let spans = |c: Calendar| {
            [
                c.week_days,
                c.weekend_days,
                c.quarter_days,
                c.year_days,
                c.maint_period_days,
            ]
        };
        assert_eq!(spans(CANON), [3, 1, 3, 12, 3]);
        assert_eq!(spans(REAL_WORLD), [7, 2, 90, 360, 30]);
    }
}
