/**
 * The argument check every relayed command shares (#923, #996). A second
 * frontend or a relay may hand a command anything; the web never sends a
 * malformed one. A command refuses such a request before anything moves,
 * with the one reason below or its own refusal value (`false`, `null`). The
 * Rust binding reads each raw JS argument and checks it the same way
 * (`engine-rs/src/charges.rs` `whole`).
 */

/** The one refusal reason for a malformed command: an id or floor that is
 *  not a whole number, or an enum value the command does not know. */
export const INVALID_REQUEST = "That request is not valid.";

/** A whole number a command may take: a safe integer, so both engines read
 *  the same value. */
export const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** The refusal for a facility kind the catalog does not hold. `canBuild`,
 *  `build`, `buildTransport` and `validateTransport` answer it in both
 *  engines instead of throwing (#1216). */
export const UNKNOWN_FACILITY = "Unknown facility.";
