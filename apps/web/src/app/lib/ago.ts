/**
 * When something was written, said the way a person says it (agent-consolidation `S8.3b`,
 * `ID220`): `just now`, `5 min ago`, `2 h ago`, `yesterday`, then the day.
 *
 * **`now` is the caller's.** Nothing here reads the clock, so a template decides how often
 * the phrase moves on and a test decides what time it is. The thresholds and the `Intl`
 * formatters are hidden here; the words are English, as the product's copy is.
 */

const minuteMs = 60 * 1000;

const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short" });

const longMonth = new Intl.DateTimeFormat("en-US", { month: "long" });

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Midnight of that day, in the runtime's own time zone. */
const dayOf = (at: Date): number =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

/**
 * How long ago `at` was, seen from `now`. A time in the future reads `just now`, never a
 * negative phrase: a clock a little behind the server's is not news to a person.
 */
export const ago = (at: Date, now: Date): string => {
  const minutes = Math.floor((now.getTime() - at.getTime()) / minuteMs);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (dayOf(at) === yesterday) return "yesterday";
  const day = `${at.getDate()} ${shortMonth.format(at)}`;
  return at.getFullYear() === now.getFullYear() ? day : `${day} ${at.getFullYear()}`;
};

/** The full date and the time, as hovering a phrase shows it: `14 September 2026, 09:05`. */
export const exactly = (at: Date): string =>
  `${at.getDate()} ${longMonth.format(at)} ${at.getFullYear()}, ${clock.format(at)}`;
