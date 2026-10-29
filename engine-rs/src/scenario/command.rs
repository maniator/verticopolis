//! The scenario file format

use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize, Debug)]
#[serde(untagged, deny_unknown_fields)]
pub enum Start {
    NewGame {
        #[serde(rename = "newGame")]
        new_game: NewGame,
    },
    Fixture {
        fixture: String,
        mode: Option<String>,
    },
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct NewGame {
    pub seed: u32,
    pub mode: String,
    /// The star the game opens at (1 to 5), so what unlocks above one star is
    /// in reach from a new game.
    pub star: Option<i64>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "op", deny_unknown_fields)]
pub enum Command {
    #[serde(rename = "setMoney")]
    SetMoney { amount: f64 },
    #[serde(rename = "build")]
    Build {
        kind: String,
        floor: i64,
        x: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "buildRow")]
    BuildRow {
        kind: String,
        floor: i64,
        from: i64,
        to: i64,
    },
    #[serde(rename = "buildTransport")]
    BuildTransport {
        kind: String,
        x: i64,
        bottom: i64,
        top: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "sell")]
    Sell {
        floor: i64,
        x: i64,
        kind: Option<String>,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "adjustRent")]
    AdjustRent {
        floor: i64,
        x: i64,
        dir: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "setNoRate")]
    SetNoRate {
        floor: i64,
        x: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "setCars")]
    SetCars {
        floor: i64,
        x: i64,
        cars: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "addCar")]
    AddCar {
        floor: i64,
        x: i64,
        reason: Option<String>,
    },
    #[serde(rename = "removeCar")]
    RemoveCar {
        floor: i64,
        x: i64,
        reason: Option<String>,
    },
    #[serde(rename = "extendTransport")]
    ExtendTransport {
        floor: i64,
        x: i64,
        end: String,
        #[serde(rename = "targetFloor")]
        target_floor: i64,
        reason: Option<String>,
    },
    #[serde(rename = "beginExtend")]
    BeginExtend { floor: i64, x: i64 },
    #[serde(rename = "endExtend")]
    EndExtend,
    #[serde(rename = "removeFacility")]
    RemoveFacility {
        floor: i64,
        x: i64,
        method: String,
        shaft: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "startFire")]
    StartFire {
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "bombThreat")]
    BombThreat,
    #[serde(rename = "evaluateStar")]
    EvaluateStar,
    #[serde(rename = "setSchedule")]
    SetSchedule {
        floor: i64,
        x: i64,
        schedule: Value,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
    },
    #[serde(rename = "callExterminator")]
    CallExterminator {
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "resolveChoice")]
    ResolveChoice { accept: bool, kind: Option<String> },
    #[serde(rename = "toggleAutoBridge")]
    ToggleAutoBridge,
    #[serde(rename = "setFilmPolicy")]
    SetFilmPolicy { floor: i64, x: i64, policy: String },
    #[serde(rename = "rerollSubtype")]
    RerollSubtype { floor: i64, x: i64 },
    #[serde(rename = "applyRentBatch")]
    ApplyRentBatch {
        kind: String,
        target: Value,
        #[serde(rename = "onlyDefaultPriced")]
        only_default_priced: Option<bool>,
    },
    #[serde(rename = "resizeTransport")]
    ResizeTransport {
        floor: i64,
        x: i64,
        bottom: i64,
        top: i64,
        #[serde(rename = "expectFail")]
        expect_fail: Option<bool>,
        reason: Option<String>,
    },
    #[serde(rename = "clearStops")]
    ClearStops { floor: i64, x: i64 },
    #[serde(rename = "setStop")]
    SetStop {
        floor: i64,
        x: i64,
        #[serde(rename = "stopFloor")]
        stop_floor: i64,
        stop: bool,
    },
    #[serde(rename = "priceUnit")]
    PriceUnit { floor: i64, x: i64, target: f64 },
    #[serde(rename = "reload")]
    Reload,
    #[serde(rename = "tick")]
    Tick {
        dt: i64,
        times: Option<i64>,
        #[serde(rename = "checkpointEvery")]
        checkpoint_every: Option<i64>,
    },
    #[serde(rename = "checkpoint")]
    Checkpoint { label: String },
}
