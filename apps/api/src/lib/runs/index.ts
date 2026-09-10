/**
 * The runs module: what a unit leaves behind, and where a stream picks up. This file is
 * the module's whole public face, so a caller writes `from "../lib/runs"` and learns
 * nothing about how a unit is claimed or how a frame maps onto one.
 */
export {
  finishUnit,
  framesPerUnit,
  hasSeenUnit,
  hasSeenWhatUnitSaid,
  unitsOf,
} from "./progress";
