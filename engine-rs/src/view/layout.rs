//! The view's layout: every slot and record width of the dynamic frame and
//! the structural snapshot, by name. A host decodes both by these numbers,
//! and `layout_json` (`viewLayout()` in the binding) hands them over, so a
//! frontend checks them instead of copying them by hand (AD-4).
//!
//! Raise `VIEW_LAYOUT_VERSION` in the same commit as any change to a slot,
//! a width, a slot's meaning or a code (`layout_tests.rs` pins the tables
//! and fails with them). The compat record pins the version, so raising it
//! also asks for a crate version bump.
use serde_json::{json, Map, Value};

/// The version of the view's layout, reported by `viewLayout()`.
pub const VIEW_LAYOUT_VERSION: u32 = 3;

/// The dynamic frame's header slots, one name each. `UNLOCKED` holds the
/// unlocked kinds as a bitmask by kind code in one double, with more than 32
/// bits in use: read bit k as `Math.floor(mask / 2 ** k) % 2`, since
/// JavaScript's bitwise operators cut a number to 32 bits. `FRAME_SEQ` counts
/// the reader's frames from 1: a host that sees it skip a number missed a
/// frame, and asks for a full one before it applies another.
pub mod header {
    pub const MINUTES: usize = 0;
    pub const TOWER_REVISION: usize = 1;
    pub const META_REVISION: usize = 2;
    pub const MEAL_OVERLAY_REVISION: usize = 3;
    pub const LOG_SEQ: usize = 4;
    pub const MONEY: usize = 5;
    pub const STAR: usize = 6;
    pub const UNLOCKED: usize = 7;
    pub const POPULATION: usize = 8;
    pub const WEATHER: usize = 9;
    pub const SANTA_FX_SEQ: usize = 10;
    pub const EXPLOSION_FX_SEQ: usize = 11;
    pub const EXPLOSION_FX_FLOOR: usize = 12;
    pub const EXPLOSION_FX_X: usize = 13;
    pub const THIEF_FX_SEQ: usize = 14;
    pub const THIEF_FX_CAUGHT: usize = 15;
    pub const THIEF_FX_FLOOR: usize = 16;
    pub const TREASURE_FX_SEQ: usize = 17;
    pub const TREASURE_FX_FLOOR: usize = 18;
    pub const TREASURE_FX_X: usize = 19;
    pub const VIP_FX_SEQ: usize = 20;
    pub const FIRES_STARTED: usize = 21;
    pub const FIRES_GUT_ROOMS: usize = 22;
    pub const BOMBS_DETONATED: usize = 23;
    pub const PENDING_CHOICE: usize = 24;
    pub const ON_HOUR_RUNS: usize = 25;
    pub const ROOMS: usize = 26;
    pub const FULL: usize = 27;
    pub const FRAME_SEQ: usize = 28;
    pub const PEOPLE: usize = 29;
    pub const UNITS: usize = 30;
    pub const TRANSPORTS: usize = 31;
}

/// Slots of the dynamic frame's header.
pub const HEADER: usize = header::TRANSPORTS + 1;

/// The slots of a drawn person's record.
pub mod person {
    pub const ID: usize = 0;
    pub const SEED: usize = 1;
    pub const STAFF: usize = 2;
    pub const STATE: usize = 3;
    pub const FLOOR: usize = 4;
    pub const X: usize = 5;
    pub const FY: usize = 6;
    pub const WAIT: usize = 7;
}

/// Slots of a person record.
pub const PERSON_RECORD: usize = person::WAIT + 1;

/// The slots of a changed room's record: its slot in the structural
/// snapshot's room list, then its frame fields.
pub mod unit {
    pub const SLOT: usize = 0;
    pub const STATE: usize = 1;
    pub const OCCUPANTS: usize = 2;
    pub const CUSTOMERS_IN: usize = 3;
    pub const HOTEL_CUSTOMERS_IN: usize = 4;
    pub const OUT_FOR_MEAL: usize = 5;
}

/// Slots of a room record in the dynamic frame.
pub const UNIT_RECORD: usize = unit::OUT_FOR_MEAL + 1;

/// The slots of a transport's record in the dynamic frame: `ID` and `CARS`,
/// then `CARS` car records, as `frameView` lays them out.
pub mod transport {
    pub const ID: usize = 0;
    pub const CARS: usize = 1;
}

/// Slots of a transport record before its cars.
pub const TRANSPORT_FIXED: usize = transport::CARS + 1;

/// The slots of one car, counted from the car's start.
pub mod car {
    pub const POSITION: usize = 0;
    pub const LOAD: usize = 1;
    pub const DIRECTION: usize = 2;
}

/// Slots of each car.
pub const CAR_RECORD: usize = car::DIRECTION + 1;

/// The structural snapshot's header slots. `HIGHEST_FLOOR` and
/// `LOWEST_FLOOR` are the highest and lowest floor any unit stands on (1 on
/// an empty tower), the bounds the camera reads; `MODE` and `CALENDAR` are
/// the game mode and the Modern calendar, by the codes in `MODES` and
/// `CALENDARS`; `SCENE_SEED` is the founding seed the scenery derives from
/// (`rng.initial_seed`, `HeaderView.sceneSeed`), fixed for a tower's life.
pub mod structure {
    pub const REVISION: usize = 0;
    pub const ROOMS: usize = 1;
    pub const RUNS: usize = 2;
    pub const SHAFTS: usize = 3;
    pub const HIGHEST_FLOOR: usize = 4;
    pub const LOWEST_FLOOR: usize = 5;
    pub const MODE: usize = 6;
    pub const CALENDAR: usize = 7;
    pub const SCENE_SEED: usize = 8;
}

/// Slots of the structural snapshot's header.
pub const STRUCTURE_HEADER: usize = structure::SCENE_SEED + 1;

/// The slots of a room in the structural snapshot.
pub mod room {
    pub const ID: usize = 0;
    pub const KIND: usize = 1;
    pub const FLOOR: usize = 2;
    pub const X: usize = 3;
    pub const WIDTH: usize = 4;
}

/// Slots of a room record in the structural snapshot.
pub const ROOM_RECORD: usize = room::WIDTH + 1;

/// The slots of a run of floor or lobby tiles: `COUNT` tiles of one kind and
/// width side by side on one floor, the k-th at `X + k * WIDTH`, every one
/// with the same frame fields.
pub mod run {
    pub const KIND: usize = 0;
    pub const FLOOR: usize = 1;
    pub const X: usize = 2;
    pub const WIDTH: usize = 3;
    pub const COUNT: usize = 4;
    pub const STATE: usize = 5;
    pub const OCCUPANTS: usize = 6;
    pub const CUSTOMERS_IN: usize = 7;
    pub const HOTEL_CUSTOMERS_IN: usize = 8;
    pub const OUT_FOR_MEAL: usize = 9;
}

/// Slots of a run record.
pub const RUN_RECORD: usize = run::OUT_FOR_MEAL + 1;

/// The slots of a transport in the structural snapshot, before its
/// `SKIPS` skipped floors.
pub mod shaft {
    pub const ID: usize = 0;
    pub const KIND: usize = 1;
    pub const X: usize = 2;
    pub const WIDTH: usize = 3;
    pub const BOTTOM: usize = 4;
    pub const TOP: usize = 5;
    pub const CARS: usize = 6;
    pub const SKIPS: usize = 7;
}

/// Slots of a shaft record before its skipped floors.
pub const SHAFT_FIXED: usize = shaft::SKIPS + 1;

/// One named table of slots, as `layout_json` hands it over: its name in the
/// JSON, the slots by camelCase name, the width key and the width.
pub(crate) struct Table {
    pub(crate) name: &'static str,
    pub(crate) slots: &'static [(&'static str, usize)],
    pub(crate) width_name: &'static str,
    pub(crate) width: usize,
}

/// Every table of the layout, in the order `layout_json` writes them.
pub(crate) const TABLES: &[Table] = &[
    Table {
        name: "header",
        slots: &[
            ("minutes", header::MINUTES),
            ("towerRevision", header::TOWER_REVISION),
            ("metaRevision", header::META_REVISION),
            ("mealOverlayRevision", header::MEAL_OVERLAY_REVISION),
            ("logSeq", header::LOG_SEQ),
            ("money", header::MONEY),
            ("star", header::STAR),
            ("unlocked", header::UNLOCKED),
            ("population", header::POPULATION),
            ("weather", header::WEATHER),
            ("santaFxSeq", header::SANTA_FX_SEQ),
            ("explosionFxSeq", header::EXPLOSION_FX_SEQ),
            ("explosionFxFloor", header::EXPLOSION_FX_FLOOR),
            ("explosionFxX", header::EXPLOSION_FX_X),
            ("thiefFxSeq", header::THIEF_FX_SEQ),
            ("thiefFxCaught", header::THIEF_FX_CAUGHT),
            ("thiefFxFloor", header::THIEF_FX_FLOOR),
            ("treasureFxSeq", header::TREASURE_FX_SEQ),
            ("treasureFxFloor", header::TREASURE_FX_FLOOR),
            ("treasureFxX", header::TREASURE_FX_X),
            ("vipFxSeq", header::VIP_FX_SEQ),
            ("firesStarted", header::FIRES_STARTED),
            ("firesGutRooms", header::FIRES_GUT_ROOMS),
            ("bombsDetonated", header::BOMBS_DETONATED),
            ("pendingChoice", header::PENDING_CHOICE),
            ("onHourRuns", header::ON_HOUR_RUNS),
            ("rooms", header::ROOMS),
            ("full", header::FULL),
            ("frameSeq", header::FRAME_SEQ),
            ("people", header::PEOPLE),
            ("units", header::UNITS),
            ("transports", header::TRANSPORTS),
        ],
        width_name: "headerWidth",
        width: HEADER,
    },
    Table {
        name: "person",
        slots: &[
            ("id", person::ID),
            ("seed", person::SEED),
            ("staff", person::STAFF),
            ("state", person::STATE),
            ("floor", person::FLOOR),
            ("x", person::X),
            ("fy", person::FY),
            ("wait", person::WAIT),
        ],
        width_name: "personWidth",
        width: PERSON_RECORD,
    },
    Table {
        name: "unit",
        slots: &[
            ("slot", unit::SLOT),
            ("state", unit::STATE),
            ("occupants", unit::OCCUPANTS),
            ("customersIn", unit::CUSTOMERS_IN),
            ("hotelCustomersIn", unit::HOTEL_CUSTOMERS_IN),
            ("outForMeal", unit::OUT_FOR_MEAL),
        ],
        width_name: "unitWidth",
        width: UNIT_RECORD,
    },
    Table {
        name: "transport",
        slots: &[("id", transport::ID), ("cars", transport::CARS)],
        width_name: "transportFixed",
        width: TRANSPORT_FIXED,
    },
    Table {
        name: "car",
        slots: &[
            ("position", car::POSITION),
            ("load", car::LOAD),
            ("direction", car::DIRECTION),
        ],
        width_name: "carWidth",
        width: CAR_RECORD,
    },
    Table {
        name: "structure",
        slots: &[
            ("revision", structure::REVISION),
            ("rooms", structure::ROOMS),
            ("runs", structure::RUNS),
            ("shafts", structure::SHAFTS),
            ("highestFloor", structure::HIGHEST_FLOOR),
            ("lowestFloor", structure::LOWEST_FLOOR),
            ("mode", structure::MODE),
            ("calendar", structure::CALENDAR),
            ("sceneSeed", structure::SCENE_SEED),
        ],
        width_name: "structureWidth",
        width: STRUCTURE_HEADER,
    },
    Table {
        name: "room",
        slots: &[
            ("id", room::ID),
            ("kind", room::KIND),
            ("floor", room::FLOOR),
            ("x", room::X),
            ("width", room::WIDTH),
        ],
        width_name: "roomWidth",
        width: ROOM_RECORD,
    },
    Table {
        name: "run",
        slots: &[
            ("kind", run::KIND),
            ("floor", run::FLOOR),
            ("x", run::X),
            ("width", run::WIDTH),
            ("count", run::COUNT),
            ("state", run::STATE),
            ("occupants", run::OCCUPANTS),
            ("customersIn", run::CUSTOMERS_IN),
            ("hotelCustomersIn", run::HOTEL_CUSTOMERS_IN),
            ("outForMeal", run::OUT_FOR_MEAL),
        ],
        width_name: "runWidth",
        width: RUN_RECORD,
    },
    Table {
        name: "shaft",
        slots: &[
            ("id", shaft::ID),
            ("kind", shaft::KIND),
            ("x", shaft::X),
            ("width", shaft::WIDTH),
            ("bottom", shaft::BOTTOM),
            ("top", shaft::TOP),
            ("cars", shaft::CARS),
            ("skips", shaft::SKIPS),
        ],
        width_name: "shaftFixed",
        width: SHAFT_FIXED,
    },
];

/// The unit state names by the code a frame carries (`frame::unit_state_code`).
pub(crate) const UNIT_STATES: [&str; 10] = [
    "construction",
    "empty",
    "occupied",
    "moving_in",
    "vacating",
    "asleep",
    "dirty",
    "infested",
    "fire",
    "gutted",
];

/// The person state names by code (`frame::person_state_code`).
pub(crate) const PERSON_STATES: [&str; 7] = [
    "toShaft", "waiting", "riding", "climbing", "toDest", "dwelling", "done",
];

/// The weather names by code (`frame::weather_code`).
pub(crate) const WEATHER: [&str; 3] = ["clear", "cloudy", "rain"];

/// The game modes by code, as a save spells them (`structure::mode_code`).
pub(crate) const MODES: [&str; 2] = ["classic", "modern"];

/// The Modern calendars by code, as a save spells them
/// (`structure::calendar_code`).
pub(crate) const CALENDARS: [&str; 2] = ["canon", "realWorld"];

/// The fields of a unit's metadata record in `unitMetaSince`'s listing, in
/// order (`meta::meta_since`).
pub(crate) const META_RECORD: [&str; 3] = ["id", "label", "subtype"];

/// The layout as a value: the version, every table's slots and width, the
/// codes (kinds, unit and person states, weather, modes, calendars) and the
/// metadata record's fields. A kind's code is its index in `kinds` (the
/// catalog's order, `Kind as usize`), and `names` holds each kind's catalog
/// name, which is a unit's label when a full metadata listing leaves the
/// unit out.
pub fn layout_json() -> Value {
    let mut m = Map::new();
    m.insert("version".into(), json!(VIEW_LAYOUT_VERSION));
    for t in TABLES {
        let slots: Map<String, Value> = t
            .slots
            .iter()
            .map(|(name, slot)| ((*name).to_owned(), json!(slot)))
            .collect();
        m.insert(t.name.into(), Value::Object(slots));
        m.insert(t.width_name.into(), json!(t.width));
    }
    let facilities = &crate::facilities::FACILITIES;
    m.insert(
        "kinds".into(),
        json!(facilities.iter().map(|f| f.key).collect::<Vec<_>>()),
    );
    m.insert(
        "names".into(),
        json!(facilities.iter().map(|f| f.name).collect::<Vec<_>>()),
    );
    m.insert("unitStates".into(), json!(UNIT_STATES));
    m.insert("personStates".into(), json!(PERSON_STATES));
    m.insert("weather".into(), json!(WEATHER));
    m.insert("modes".into(), json!(MODES));
    m.insert("calendars".into(), json!(CALENDARS));
    m.insert("metaRecord".into(), json!(META_RECORD));
    Value::Object(m)
}
