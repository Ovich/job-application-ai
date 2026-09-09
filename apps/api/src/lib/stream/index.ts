/**
 * The stream module: the leaf catalogue and the envelope that puts a leaf on the wire.
 * This file is the module's whole public face, so a caller writes
 * `from "../lib/stream"` and learns nothing about how a frame is numbered or how the
 * connection is kept alive.
 */
export {
  catalogueVersion,
  createEnvelope,
  type Envelope,
  type Frame,
  heartbeatIntervalMs,
  type Leaf,
  leafSchema,
} from "./envelope";
