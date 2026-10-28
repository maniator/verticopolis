import { TsEngine } from "../engine/port/tsEngine";
import { describeEngineContract } from "./engineContract.fixture";
import { describeEngineLifecycle } from "./engineLifecycle.fixture";
import { describeEngineQueries } from "./engineQueries.fixture";
import { copyOf } from "./engineSubject.fixture";

// The port contract on the TypeScript engine; the Rust engine runs the same
// cases in `engineContract.integration.test.ts`.
const make = (sim: Parameters<typeof copyOf>[0]) => new TsEngine(copyOf(sim));
describeEngineContract("TsEngine", make);
describeEngineLifecycle("TsEngine", make);
describeEngineQueries("TsEngine", make);
