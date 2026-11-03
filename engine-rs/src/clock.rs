//! Port of `src/shared/Clock.ts` and `src/shared/calendar.ts`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarKind {
    Canon,
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

    /// The mode a scenario or a host names, by its saved spelling.
    pub fn parse(s: &str) -> Option<GameMode> {
        match s {
            "classic" => Some(GameMode::Classic),
            "modern" => Some(GameMode::Modern),
            _ => None,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// One reading of the clock on a calendar. The web holds the same rows in
    /// `src/shared/Clock.test.ts`. Keep the two tables identical.
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
