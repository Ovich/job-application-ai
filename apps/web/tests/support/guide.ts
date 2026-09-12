import { TestBed } from "@angular/core/testing";
import { beforeEach } from "vitest";
import { atOnce, GUIDE_PACE } from "../../src/app/guide/pace";

/**
 * The suite performs nothing (`G7`, `2026-09-13-guided-effects.spec.md`).
 *
 * A guided sequence exists to be watched, and a test that watched it would wait on wall
 * clock and flake on a slow machine. So every case is given a pace of zero: the steps
 * run to their end state in the same tick, and what a case asks is the order things
 * happened in and what is finally on the screen — never how long it took.
 *
 * The same trick as the AI mock's `tps=0` (`SL1`, spec `D13`), for the same reason and
 * with the same consequence: nothing in the suite ever sleeps.
 */
beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [{ provide: GUIDE_PACE, useValue: atOnce }],
  });
});
