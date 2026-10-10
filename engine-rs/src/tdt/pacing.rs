//! The 1994 original's variable time pacing (`timePacing.ts`): the two
//! frame/minute conversions the TDT codec needs.

pub const FRAMES_PER_DAY: f64 = 2600.0;
pub const DAY_START_MINUTE: f64 = 7.0 * 60.0;

/// The canon pacing periods: (frameEnd, minuteEnd).
const PERIODS: [(f64, f64); 9] = [
    (400.0, 300.0),
    (800.0, 330.0),
    (1200.0, 360.0),
    (1600.0, 600.0),
    (1720.0, 660.0),
    (1880.0, 690.0),
    (2000.0, 840.0),
    (2400.0, 1080.0),
    (2600.0, 1440.0),
];

fn wrap(v: f64, span: f64) -> f64 {
    ((v % span) + span) % span
}

/// `minuteOfDayForFrame`.
pub fn minute_of_day_for_frame(frame: f64) -> f64 {
    if !frame.is_finite() {
        return DAY_START_MINUTE;
    }
    let f = wrap(frame, FRAMES_PER_DAY);
    let mut frame_start = 0.0;
    let mut minute_start = 0.0;
    for (frame_end, minute_end) in PERIODS {
        if f < frame_end {
            let rate = (minute_end - minute_start) / (frame_end - frame_start);
            let since_day_start = minute_start + (f - frame_start) * rate;
            return wrap(DAY_START_MINUTE + since_day_start, 24.0 * 60.0).floor();
        }
        frame_start = frame_end;
        minute_start = minute_end;
    }
    DAY_START_MINUTE
}

/// `frameForMinuteOfDay`.
pub fn frame_for_minute_of_day(minute_of_day: f64) -> f64 {
    if !minute_of_day.is_finite() {
        return 0.0;
    }
    let m = wrap(minute_of_day - DAY_START_MINUTE, 24.0 * 60.0);
    let mut frame_start = 0.0;
    let mut minute_start = 0.0;
    for (frame_end, minute_end) in PERIODS {
        if m < minute_end {
            let rate = (minute_end - minute_start) / (frame_end - frame_start);
            return (frame_start + (m - minute_start) / rate).floor();
        }
        frame_start = frame_end;
        minute_start = minute_end;
    }
    0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canon_anchors() {
        assert_eq!(minute_of_day_for_frame(0.0), 420.0);
        assert_eq!(minute_of_day_for_frame(2300.0), 0.0);
        assert_eq!(frame_for_minute_of_day(0.0), 2300.0);
        assert_eq!(frame_for_minute_of_day(420.0), 0.0);
        assert_eq!(minute_of_day_for_frame(f64::NAN), 420.0);
    }
}
