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
            // Multiply before dividing: a frame count times a whole-number
            // minute span divides exactly where the pacing is whole, so a
            // float rate (0.6, 0.75) cannot land a minute short.
            let since_day_start = minute_start
                + ((f - frame_start) * (minute_end - minute_start) / (frame_end - frame_start))
                    .floor();
            return wrap(DAY_START_MINUTE + since_day_start, 24.0 * 60.0);
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
            // The first frame whose minute is `m`, so a minute read from a
            // file writes back as the same minute. Where a frame spans more
            // than one minute (1880 to 2000) not every minute has a frame, and
            // the first frame at or past it is the answer.
            let frame = frame_start
                + ((m - minute_start) * (frame_end - frame_start) / (minute_end - minute_start))
                    .ceil();
            let earlier = frame - 1.0;
            let reads_back =
                |f: f64| minute_of_day_for_frame(f) == wrap(minute_of_day, 24.0 * 60.0).floor();
            return if !reads_back(frame) && earlier >= 0.0 && reads_back(earlier) {
                earlier
            } else {
                frame
            };
        }
        frame_start = frame_end;
        minute_start = minute_end;
    }
    0.0
}

/// `paceFactor`: how fast sim minutes should accumulate per unit of real time
/// at `minute_of_day`, relative to uniform pacing (1.0 everywhere). A
/// non-finite minute is neutral.
pub fn pace_factor(minute_of_day: f64) -> f64 {
    if !minute_of_day.is_finite() {
        return 1.0;
    }
    let m = wrap(minute_of_day - DAY_START_MINUTE, 24.0 * 60.0);
    let mut frame_start = 0.0;
    let mut minute_start = 0.0;
    for (frame_end, minute_end) in PERIODS {
        if m < minute_end {
            let rate = (minute_end - minute_start) / (frame_end - frame_start);
            return rate / ((24.0 * 60.0) / FRAMES_PER_DAY);
        }
        frame_start = frame_end;
        minute_start = minute_end;
    }
    1.0
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

    #[test]
    fn a_minute_read_from_a_file_writes_back_as_the_same_minute() {
        for frame in 0..FRAMES_PER_DAY as i64 {
            let minute = minute_of_day_for_frame(frame as f64);
            let written = frame_for_minute_of_day(minute);
            assert_eq!(
                minute_of_day_for_frame(written),
                minute,
                "frame {frame}, minute {minute}"
            );
        }
    }

    #[test]
    fn every_minute_the_pacing_can_reach_has_a_frame() {
        let reachable: std::collections::BTreeSet<i64> = (0..FRAMES_PER_DAY as i64)
            .map(|f| minute_of_day_for_frame(f as f64) as i64)
            .collect();
        for minute in &reachable {
            let frame = frame_for_minute_of_day(*minute as f64);
            assert_eq!(minute_of_day_for_frame(frame) as i64, *minute);
        }
        assert!(
            reachable.len() < 1440,
            "the late frames span more than a minute, so some minutes have none"
        );
    }
}
