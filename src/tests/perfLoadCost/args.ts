import { CONDITIONS, type Condition } from "./sample";

export interface Options {
  before: string;
  after: string;
  reps: number;
  throttles: number[];
  conditions: Condition[];
  out: string;
  dt: number;
}

export const USAGE = `usage: npm run perf:load-cost -- --before <dist> --after <dist> [--reps 20] [--throttle 1,4] [--conditions L2,L1,L3,L4] [--out <dir>] [--dt 2]
  --before / --after   two built dist folders (VC_TOOLING=1 VC_ENGINE=wasm npm run build, once per commit)
  Browser: PW_CHROMIUM_PATH or PW_CHROMIUM_CHANNEL, and PW_CHROMIUM_ARGS, as for perf:compare.`;

/** Parse the command line; throws a sentence on anything unusable. */
export function parseArgs(argv: readonly string[]): Options {
  const o: Options = { before: "", after: "", reps: 20, throttles: [1, 4], conditions: ["L2", "L1", "L3", "L4"], out: "perf-load-cost", dt: 2 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case "--before":
        o.before = value();
        break;
      case "--after":
        o.after = value();
        break;
      case "--out":
        o.out = value();
        break;
      case "--reps":
        o.reps = whole(flag, value());
        break;
      case "--dt":
        o.dt = positive(flag, value());
        break;
      case "--throttle":
        o.throttles = value().split(",").map((s) => whole(flag, s));
        break;
      case "--conditions":
        o.conditions = value().split(",").map((s) => condition(s));
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  if (!o.before || !o.after) throw new Error("--before and --after are both required");
  if (o.before === o.after) throw new Error("--before and --after name the same folder");
  if (o.reps < 6) throw new Error("--reps must be at least 6, the fewest that gives a 95% interval for a median");
  return o;
}

function whole(flag: string, s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag}: "${s}" is not a whole number of at least 1`);
  return n;
}

function positive(flag: string, s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag}: "${s}" is not a positive number`);
  return n;
}

function condition(s: string): Condition {
  const c = s.trim().toUpperCase();
  if (!(CONDITIONS as readonly string[]).includes(c)) throw new Error(`--conditions: "${s}" is not one of ${CONDITIONS.join(", ")}`);
  return c as Condition;
}
