// The reset a provider's wall message gives, in the shapes providers have used (D4, D5):
// `2:29 AM` is its first occurrence no earlier than five minutes before the wall line, in
// the message's zone else the machine's; a date, a zone that is UTC or an IANA name, and
// `in N minutes|hours` read as written; of two times the later counts; anything else is no
// reset time, and a wrong time is worse than none. A zone that is an abbreviation such as
// PST makes the time beside it unreadable.
//
// Pure: the clock is the caller's, so the tests set it.

// --- the reset, as providers have written it ---------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** A usable zone: UTC or an IANA name. An abbreviation such as PST makes the time unreadable. */
export function validZone(text: string): string | null {
  const z = text.trim();
  if (/^UTC$/iu.test(z)) return "UTC";
  // The shape is loose on purpose: digits, hyphens and `+` all occur in real IANA
  // names (Etc/GMT+5, America/Port-au-Prince), and the time-zone database below is
  // the real validator. A bare name stays unreadable: an abbreviation never validates.
  if (/^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)+$/u.test(z)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: z });
      return z;
    } catch {
      return null;
    }
  }
  return null;
}

/** The zone's offset from UTC, in ms (positive east), at the instant `ts`. */
function tzOffsetMs(ts: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(ts));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUTC - Math.floor(ts / 1000) * 1000;
}

/** The instant of a wall-clock time in a zone; null when the zone is unusable. */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number | null {
  if (tz === "UTC") return Date.UTC(year, month, day, hour, minute);
  try {
    const guess = Date.UTC(year, month, day, hour, minute);
    const off1 = tzOffsetMs(guess, tz);
    let ts = guess - off1;
    const off2 = tzOffsetMs(ts, tz);
    if (off2 !== off1) ts = guess - off2;
    return ts;
  } catch {
    return null;
  }
}

/** The calendar date in a zone at an instant: a zoned reset counts its days there (D4). */
function zonedYMD(ts: number, tz: string): [number, number, number] {
  if (tz === "UTC") {
    const n = new Date(ts);
    return [n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()];
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return [get("year"), get("month") - 1, get("day")];
}

function hour12(h: number, ap: string | undefined): number {
  const lower = (ap ?? "").toLowerCase(); // ASCII: am/pm is ASCII however the message cases it
  if (lower === "pm" && h < 12) return h + 12;
  if (lower === "am" && h === 12) return 0;
  return h;
}

/** A parsed calendar day stands only inside its month (D5: no fabricated resets). */
function validDay(year: number, month: number, day: number): boolean {
  if (day < 1) return false;
  return day <= new Date(year, month + 1, 0).getDate();
}

/** A parsed clock time stands only on the clock (D5). */
function validTime(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** A time alone means its first occurrence no earlier than five minutes before `now`. */
function firstOccurrence(nowMs: number, make: (dayOffset: number) => number | null): number | null {
  const today = make(0);
  if (today === null) return null;
  if (today >= nowMs - 5 * 60 * 1000) return today;
  return make(1);
}

function blank(m: string): string {
  return " ".repeat(m.length);
}

/**
 * The reset a provider message gives, as an ISO time with offset, or null when it gives
 * none (D4, D5). Read from the message's first line, the line the run keeps; `nowMs`
 * is the moment the wall line is written.
 */
export function parseWallReset(message: string, nowMs: number): string | null {
  const cands: number[] = [];
  // The record's first line only: it is the text the run keeps, so a reset always
  // traces to a recorded message, and a stray timestamp further down never counts (D5).
  let text = message.split("\n")[0] ?? "";

  // `in N minutes|hours`, counted from when the lane stopped.
  text = text.replace(
    /(?:^|[^0-9A-Za-z_])in[ \t\n\f\r\v]+([0-9]+)[ \t\n\f\r\v]+(minutes?|hours?)(?:$|[^0-9A-Za-z_])/giu,
    (m, n: string, unit: string) => {
      const step = /^hour/iu.test(unit) ? 3600 : 60;
      const t = nowMs + Number(n) * step * 1000;
      // An out-of-range wait is no reset time, never a crash (D5).
      if (Number.isFinite(t) && !Number.isNaN(new Date(t).getTime())) cands.push(t);
      return blank(m);
    },
  );

  // `Oct 5th, 2026 2:29 AM` and `Oct 5, 2026 2:29 AM`, in the zone beside them else the
  // machine's. A zone that is an abbreviation makes this time unreadable, so the whole
  // match is masked out rather than left for the bare scan to read as machine time.
  text = text.replace(
    /(?:^|[^0-9A-Za-z_])(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ \t\n\f\r\v]+([0-9]{1,2})(?:st|nd|rd|th)?[ \t\n\f\r\v]*,?[ \t\n\f\r\v]+([0-9]{4})[ \t\n\f\r\v]+([0-9]{1,2})(?::([0-9]{2}))?[ \t\n\f\r\v]*(am|pm)(?:$|[^0-9A-Za-z_])(?:[ \t\n\f\r\v]*\(([^)]*)\))?/giu,
    (
      m,
      mon: string,
      day: string,
      year: string,
      h: string,
      mi: string | undefined,
      ap: string,
      zone?: string,
    ) => {
      const tz = zone === undefined ? "" : (validZone(zone) ?? "");
      if (zone !== undefined && tz === "") return blank(m);
      const month = MONTHS[mon.slice(0, 3).toLowerCase()] ?? 0; // ASCII: month names are ASCII
      const hour = hour12(Number(h), ap);
      const minute = Number(mi ?? "0");
      if (!validDay(Number(year), month, Number(day)) || !validTime(hour, minute)) {
        return blank(m);
      }
      const instant =
        tz === ""
          ? new Date(Number(year), month, Number(day), hour, minute).getTime()
          : zonedInstant(Number(year), month, Number(day), hour, minute, tz);
      if (instant !== null) cands.push(instant);
      return blank(m);
    },
  );

  // `3am (UTC)`: a time with an explicit zone, whose zone is the message's own. A bare
  // time there follows the same today-or-tomorrow rule in that zone.
  text = text.replace(
    /(?:^|[^0-9A-Za-z_])([0-9]{1,2})(?::([0-9]{2}))?[ \t\n\f\r\v]*(am|pm)?[ \t\n\f\r\v]*\(([^)]*)\)/giu,
    (m, h: string, mi: string | undefined, ap: string | undefined, zone: string) => {
      const tz = validZone(zone);
      if (tz === null) return blank(m); // an abbreviation: the time is unreadable
      const hour = hour12(Number(h), ap);
      const minute = Number(mi ?? "0");
      if (!validTime(hour, minute)) return blank(m);
      const instant = firstOccurrence(nowMs, (dayOffset) => {
        const [y, mo, day] = zonedYMD(nowMs, tz);
        return zonedInstant(y, mo, day + dayOffset, hour, minute, tz);
      });
      if (instant !== null) cands.push(instant);
      return blank(m);
    },
  );

  // A time alone: 2:29 today, or tomorrow once it is more than five minutes past (D4).
  // The scan runs for its callback, which collects the candidates; its result is unread.
  text.replace(
    /(?:^|[^0-9A-Za-z_])([0-9]{1,2}):([0-9]{2})[ \t\n\f\r\v]*(am|pm)?(?:$|[^0-9A-Za-z_])|(?:^|[^0-9A-Za-z_])([0-9]{1,2})[ \t\n\f\r\v]+(am|pm)(?:$|[^0-9A-Za-z_])/giu,
    (
      m,
      h1: string | undefined,
      mi1: string | undefined,
      ap1: string | undefined,
      h2: string | undefined,
      ap2: string | undefined,
    ) => {
      const h = h1 ?? h2;
      if (h === undefined) return blank(m);
      const minute = Number(mi1 ?? "0");
      const hour = hour12(Number(h), ap1 ?? ap2);
      if (!validTime(hour, minute)) return blank(m);
      const instant = firstOccurrence(nowMs, (dayOffset) => {
        const n = new Date(nowMs);
        return new Date(
          n.getFullYear(),
          n.getMonth(),
          n.getDate() + dayOffset,
          hour,
          minute,
        ).getTime();
      });
      if (instant !== null) cands.push(instant);
      return blank(m);
    },
  );

  if (cands.length === 0) return null;
  const latest = Math.max(...cands);
  return new Date(latest).toISOString().replace(/\.[0-9]+Z$/u, "Z");
}
