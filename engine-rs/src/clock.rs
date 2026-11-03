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

    fn row(
        name: &'static str,
        calendar: Calendar,
        minutes: f64,
        when: [i64; 6],
        is_weekend: bool,
    ) -> Row {
        let [day, day_of_week, quarter, year, hour, minute] = when;
        Row {
            name,
            calendar,
            minutes,
            day,
            day_of_week,
            is_weekend,
            quarter,
            year,
            hour,
            minute,
        }
    }

    #[test]
    fn readings_match_the_web_table() {
        // when = [day, day of week, quarter, year, hour, minute]
        let rows = [
            row(
                "canon, tower founded",
                CANON,
                420.0,
                [0, 0, 0, 0, 7, 0],
                false,
            ),
            row(
                "canon, weekend slot",
                CANON,
                3665.0,
                [2, 2, 0, 0, 13, 5],
                true,
            ),
            row(
                "canon, second quarter",
                CANON,
                4380.0,
                [3, 0, 1, 0, 1, 0],
                false,
            ),
            row(
                "canon, year rollover",
                CANON,
                17880.0,
                [12, 0, 0, 1, 10, 0],
                false,
            ),
            row(
                "canon, last day of the year",
                CANON,
                17220.0,
                [11, 2, 3, 0, 23, 0],
                true,
            ),
            row(
                "real world, tower founded",
                REAL_WORLD,
                420.0,
                [0, 0, 0, 0, 7, 0],
                false,
            ),
            row(
                "real world, first Saturday",
                REAL_WORLD,
                7710.0,
                [5, 5, 0, 0, 8, 30],
                true,
            ),
            row(
                "real world, second quarter",
                REAL_WORLD,
                129660.0,
                [90, 6, 1, 0, 1, 0],
                true,
            ),
            row(
                "real world, year rollover",
                REAL_WORLD,
                519120.0,
                [360, 3, 0, 1, 12, 0],
                false,
            ),
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
