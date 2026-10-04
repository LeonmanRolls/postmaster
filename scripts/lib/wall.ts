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
  if (/^[A-Za-z]+(?:_[A-Za-z]+)*(?:\/[A-Za-z]+(?:_[A-Za-z]+)*)+$/u.test(z)) {
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

function hour12(h: number, ap: string | undefined): number {
  const lower = (ap ?? "").toLowerCase(); // ASCII: am/pm is ASCII however the message cases it
  if (lower === "pm" && h < 12) return h + 12;
  if (lower === "am" && h === 12) return 0;
  return h;
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
 * none (D4, D5). `nowMs` is the moment the wall line is written.
 */
export function parseWallReset(message: string, nowMs: number): string | null {
  const cands: number[] = [];
  let text = message;

  // `in N minutes|hours`, counted from when the lane stopped.
  text = text.replace(
    /(?:^|[^0-9A-Za-z_])in[ \t\n\f\r\v]+([0-9]+)[ \t\n\f\r\v]+(minutes?|hours?)(?:$|[^0-9A-Za-z_])/giu,
    (m, n: string, unit: string) => {
      const step = /^hour/iu.test(unit) ? 3600 : 60;
      cands.push(nowMs + Number(n) * step * 1000);
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
      const instant = firstOccurrence(nowMs, (dayOffset) => {
        const n = new Date(nowMs);
        const [y, mo, day] =
          tz === "UTC"
            ? [n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()]
            : [n.getFullYear(), n.getMonth(), n.getDate()];
        return zonedInstant(y, mo, day + dayOffset, hour, minute, tz);
      });
      if (instant !== null) cands.push(instant);
      return blank(m);
    },
  );

  // A time alone: 2:29 today, or tomorrow once it is more than five minutes past (D4).
  text = text.replace(
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
