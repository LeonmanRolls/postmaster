/**
 * Personal data found by patterns alone: no model, no network, and the same answer every time.
 * #208's trial of whether the private-data check's patterns can find what Jev 1.13 found
 * (see ../method.md). A rule finds a value by its shape, by a checksum where the value carries
 * one, by a word beside it that says what it is, or by the slot it sits in, such as an author
 * field or a sign-off line. Every exclusion is made here, in code.
 */

export type Kind = "person" | "email" | "phone" | "postal-address" | "other-personal";

export const KINDS: Kind[] = ["person", "email", "phone", "postal-address", "other-personal"];

export interface Finding {
  kind: Kind;
  rule: string;
  start: number;
  end: number;
}

type Rule = (line: string, context: string) => Finding[];

const finding = (kind: Kind, rule: string, start: number, end: number): Finding => ({ kind, rule, start, end });

// Names

/** One word of a personal name: capitalised, with Mc, Mac, O' or D' and hyphenated parts allowed. */
const PART = String.raw`(?:Mc|Mac|O['’]|D['’])?\p{Lu}\p{Ll}+`;
const WORD = String.raw`${PART}(?:-${PART})*`;
/** What may stand between two words of a name: a nickname in quotes, initials, and particles such as "van" or "al". */
const GAP = String.raw`\s+(?:["“'][\p{L}.\s-]{1,20}["”']\s+)?(?:\p{Lu}\.\s+)*(?:(?:van|von|der|den|de|del|della|da|di|du|le|la|al|el|bin|ibn|ter|ten|zu|y)\s+)*`;
/** A name ends where its last word does, never inside a longer word such as "JavaScript". */
const FULL_NAME = new RegExp(String.raw`${WORD}(?:${GAP}${WORD})+(?!\p{L})`, "uy");
const ANY_NAME = new RegExp(String.raw`${WORD}(?:${GAP}${WORD})*(?!\p{L})`, "uy");

/** Names that stand for nobody. */
const PLACEHOLDERS = new Set([
  "jane doe",
  "john doe",
  "jane smith",
  "john smith",
  "joe bloggs",
  "fred bloggs",
  "max mustermann",
  "erika mustermann",
  "test user",
  "example user",
  "your name",
  "first last",
  "firstname lastname",
  "foo bar",
  "ola nordmann",
  "kari nordmann",
  "mario rossi",
  "jean dupont",
]);

/** Words that make a name a product, a vendor, an organisation or one of this project's roles. */
const NOT_PERSON = new Set([
  "actions",
  "agent",
  "agents",
  "amazon",
  "anthropic",
  "apple",
  "astra",
  "authors",
  "bot",
  "bun",
  "claude",
  "coachman",
  "code",
  "codex",
  "contributors",
  "copilot",
  "corp",
  "corporation",
  "cursor",
  "fable",
  "foundation",
  "gemini",
  "github",
  "gitlab",
  "gmbh",
  "google",
  "grok",
  "haiku",
  "herdr",
  "inc",
  "institute",
  "javascript",
  "jev",
  "labs",
  "linux",
  "llc",
  "ltd",
  "luna",
  "meta",
  "microsoft",
  "mimo",
  "muse",
  "node",
  "openai",
  "opus",
  "postmaster",
  "project",
  "python",
  "sentinel",
  "software",
  "sol",
  "sonnet",
  "studio",
  "systems",
  "team",
  "typesafe",
  "typescript",
  "university",
  "workhorse",
  "xiaomi",
]);

function namesAProduct(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[\s.-]+/)
    .some((word) => NOT_PERSON.has(word));
}

function personName(text: string): boolean {
  return !PLACEHOLDERS.has(text.toLowerCase().replace(/\s+/g, " ")) && !namesAProduct(text);
}

function nameAt(line: string, at: number, full: boolean): [number, number] | null {
  const pattern = full ? FULL_NAME : ANY_NAME;
  pattern.lastIndex = at;
  const match = pattern.exec(line);
  if (!match || !personName(match[0])) return null;
  return [at, at + match[0].length];
}

/** A capture's front matter: a title beside a link is a citation, so its author field is too. */
function citation(context: string): boolean {
  return /^\s*title\s*:/m.test(context) && /^\s*(?:url|doi|retrieved|arxiv)\s*:/m.test(context);
}

const COMPANY_AFTER = /^,?\s*(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|AG|BV|Foundation|Contributors|Authors|and contributors|& contributors)\b/u;

interface Slot {
  rule: string;
  key: RegExp;
  full: boolean;
  /** A named relative is a family detail as well as a name. */
  family?: boolean;
}

/** Places a name sits: each key is matched without regard to case; the name after it with it. */
const SLOTS: Slot[] = [
  {
    rule: "sign-off",
    key: /^\s*(?:[#*/>;-]+\s*)?(?:signed-off-by|co-authored-by|reviewed-by|acked-by|tested-by|reported-by|suggested-by|helped-by)\s*:\s*/giu,
    full: true,
  },
  {
    rule: "author-field",
    key: /(?:^|[\s{,([])["']?[\w-]*?(?:authors?|maintainers?|contributors?|committer|owner|assignee|reporter|signer|contact|(?:full|display|real|first|last|given|family|author|owner|contact|legal)[_-]?name)["']?\s*[:=]\s*[["'\s]*/giu,
    full: true,
  },
  {
    rule: "copyright",
    key: /\bcopyright\b\s*(?:\(c\)|©)?\s*(?:\d{4}(?:\s*[-–,]\s*\d{4})*,?\s*)?(?:by\s+)?/giu,
    full: true,
  },
  { rule: "git-identity", key: /(?:\buser\.name|\bGIT_(?:AUTHOR|COMMITTER)_NAME)\s*[= ]\s*["']?/gu, full: true },
  { rule: "title", key: /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame)\.?\s+/gu, full: false },
  { rule: "self-introduction", key: /\bmy name is\s+/giu, full: false },
  {
    rule: "relative",
    key: /\b(?:mother|father|mum|mom|dad|wife|husband|partner|spouse|sister|brother|son|daughter|grandmother|grandfather|grandma|grandpa|aunt|uncle|cousin|niece|nephew|fianc[ée]e?|stepmother|stepfather)\b[,:]?\s+/giu,
    full: true,
    family: true,
  },
  { rule: "self-introduction", key: /\b(?:I am|I'm|I’m)\s+/gu, full: true },
  {
    rule: "credit",
    key: /\b(?:thanks to|thanks|thank you|kudos to|kudos|cheers|assigned to|reported by|written by|created by|maintained by|contributed by|reviewed by|signed by|on behalf of|courtesy of|according to|ask|contact|cc)\b[,:]?\s+/giu,
    full: true,
  },
];

const slots: Rule = (line, context) => {
  const out: Finding[] = [];
  for (const slot of SLOTS) {
    for (const key of line.matchAll(slot.key)) {
      const at = (key.index ?? 0) + key[0].length;
      const span = nameAt(line, at, slot.full);
      if (!span) continue;
      if (slot.rule === "author-field" && /author/i.test(key[0]) && citation(context)) continue;
      if (slot.rule === "copyright" && COMPANY_AFTER.test(line.slice(span[1]))) continue;
      out.push(finding("person", slot.rule, span[0], span[1]));
      if (slot.family) out.push(finding("other-personal", slot.rule, key.index ?? 0, span[1]));
    }
  }
  const identity = new RegExp(String.raw`(${WORD}(?:${GAP}${WORD})+)\s*<[^<>\s@]+@[^<>\s]+>`, "gu");
  for (const match of line.matchAll(identity)) {
    if (personName(match[1])) out.push(finding("person", "name-and-address", match.index ?? 0, (match.index ?? 0) + match[1].length));
  }
  return out;
};

// Email addresses

const MAILBOX = /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}._%+-]+)@((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?![\p{L}\p{N}-])/gu;
const NOREPLY = new Set(["noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "mailer-daemon"]);
const RESERVED = ["example", "example.com", "example.net", "example.org", "test", "invalid", "localhost"];
/** Mailboxes that belong to a role rather than a person (RFC 2142 and their like). */
const ROLES = new Set([
  "abuse",
  "admin",
  "alerts",
  "billing",
  "bot",
  "bugs",
  "careers",
  "ci",
  "community",
  "contact",
  "dev",
  "developers",
  "devs",
  "enquiries",
  "feedback",
  "git",
  "github",
  "hello",
  "help",
  "hostmaster",
  "hr",
  "info",
  "inquiries",
  "jobs",
  "legal",
  "mail",
  "maintainers",
  "marketing",
  "media",
  "news",
  "noc",
  "notifications",
  "office",
  "opensource",
  "postmaster",
  "press",
  "privacy",
  "root",
  "sales",
  "security",
  "service",
  "support",
  "team",
  "webmaster",
]);

const mailboxes: Rule = (line) => {
  const out: Finding[] = [];
  for (const match of line.matchAll(MAILBOX)) {
    const local = match[1].toLowerCase().replace(/\+.*$/, "");
    const domain = match[2].toLowerCase();
    if (NOREPLY.has(local) || domain === "users.noreply.github.com") continue;
    if (RESERVED.some((r) => domain === r || domain.endsWith(`.${r}`))) continue;
    if (ROLES.has(local)) continue;
    out.push(finding("email", "email", match.index ?? 0, (match.index ?? 0) + match[0].length));
  }
  return out;
};

// Phone numbers

const PHONE_WORD =
  /\b(?:tel|telephone|phone|mobile|cell|cellphone|call|ring|whatsapp|whats app|signal|fax|landline|text me)\b|phone_?number|phoneNumber|\b(?:contact|home|work|office|emergency)\s+(?:number|no\.?)/i;
const PHONE = /(?<![\w+./:@-])(?:\+\d|\(\d{2,5}\)|\d)[\d ().-]{6,22}\d(?![\w/:@-]|\.\w)/g;
const TOLL_FREE = /^(?:800|888|877|866|855|844|833)/;

const phone: Rule = (line) => {
  const out: Finding[] = [];
  const word = PHONE_WORD.test(line);
  for (const match of line.matchAll(PHONE)) {
    const text = match[0];
    const digits = text.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) continue;
    if (/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/.test(text) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) continue;
    if (/^[\d.]+$/.test(text) && text.split(".").length === 2) continue; // a decimal number
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (national.length === 10 && TOLL_FREE.test(national)) continue; // a business's free line
    const international = text.startsWith("+");
    if (!international && !word) continue;
    if (!international && !/[ ().-]/.test(text)) continue;
    out.push(finding("phone", "phone", match.index ?? 0, (match.index ?? 0) + text.length));
  }
  return out;
};

// Numbers that carry their own check, and numbers named by the word before them

const CARD = /(?<![\w.-])(?:\d{4}[ -]){3}\d{1,7}(?![\w-]|\.\d)|(?<![\w.-])\d{4}[ -]\d{6}[ -]\d{4,5}(?![\w-]|\.\d)|(?<![\w.-])\d{13,19}(?![\w-]|\.\d)/g;
const CARD_WORD = /\b(?:card|visa|mastercard|amex|american express|credit|debit|payment)\b/i;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The issuer prefixes and lengths of the common card networks. */
function issuer(d: string): boolean {
  const n = d.length;
  return (
    (d.startsWith("4") && (n === 13 || n === 16 || n === 19)) ||
    (/^(?:5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720))/.test(d) && n === 16) ||
    (/^3[47]/.test(d) && n === 15) ||
    (/^(?:6011|65|64[4-9]|62|35)/.test(d) && n >= 16) ||
    (/^3(?:0[0-5]|[689])/.test(d) && n >= 14)
  );
}

const card: Rule = (line) => {
  const out: Finding[] = [];
  for (const match of line.matchAll(CARD)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits) || !issuer(digits)) continue;
    if (!/[ -]/.test(match[0]) && !CARD_WORD.test(line)) continue;
    out.push(finding("other-personal", "card", match.index ?? 0, (match.index ?? 0) + match[0].length));
  }
  return out;
};

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;

function mod97(account: string): number {
  const moved = account.slice(4) + account.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const value = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest;
}

const iban: Rule = (line) => {
  const out: Finding[] = [];
  for (const match of line.matchAll(IBAN)) {
    const account = match[0].replace(/ /g, "");
    if (account.length < 15 || account.length > 34 || mod97(account) !== 1) continue;
    if (!match[0].includes(" ") && !/\biban\b/i.test(line)) continue;
    out.push(finding("other-personal", "iban", match.index ?? 0, (match.index ?? 0) + match[0].length));
  }
  return out;
};

const SSN = /(?<![\w-])(\d{3})-(\d{2})-(\d{4})(?![\w-])/g;
const SSN_WORD = /\b(?:ssn|social security)\b/i;
const SSN_EXAMPLES = new Set(["123-45-6789", "078-05-1120", "219-09-9999"]);

const ssn: Rule = (line) => {
  const out: Finding[] = [];
  const word = SSN_WORD.test(line);
  for (const match of line.matchAll(SSN)) {
    const [, area, group, serial] = match;
    const issued = area !== "000" && area !== "666" && !area.startsWith("9") && group !== "00" && serial !== "0000";
    if (!word && (!issued || SSN_EXAMPLES.has(match[0]))) continue;
    out.push(finding("other-personal", "ssn", match.index ?? 0, (match.index ?? 0) + match[0].length));
  }
  return out;
};

const ID_WORD = /\b(?:passport|driver'?s licen[cs]e|licen[cs]e number|national insurance|ni number|nino|nhs number|tax id|tax number|national id|identity card|identity number|id number|customer number|account number|membership number|patient number)\b/gi;
const ID_VALUE = /(?<![\w-])[A-Z0-9][A-Z0-9-]{4,17}(?![\w-])/g;

const idNumber: Rule = (line) => {
  const out: Finding[] = [];
  for (const word of line.matchAll(ID_WORD)) {
    const from = (word.index ?? 0) + word[0].length;
    const window = line.slice(from, from + 40);
    for (const value of window.matchAll(ID_VALUE)) {
      if ((value[0].match(/\d/g) ?? []).length < 5) continue;
      const start = from + (value.index ?? 0);
      out.push(finding("other-personal", "id-number", start, start + value[0].length));
      break;
    }
  }
  return out;
};

const BIRTH_WORD = /\b(?:date of birth|birth ?date|dob|d\.o\.b|born|birthday)\b/gi;
const DATE = /^[^\n]{0,30}?\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(?:19|20)\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.](?:19|20)?\d{2}|(?:19|20)\d{2})\b/i;

const birth: Rule = (line) => {
  const out: Finding[] = [];
  for (const word of line.matchAll(BIRTH_WORD)) {
    const from = (word.index ?? 0) + word[0].length;
    const date = DATE.exec(line.slice(from));
    if (date) out.push(finding("other-personal", "date-of-birth", word.index ?? 0, from + date[0].length));
  }
  return out;
};

// Details of a person's life, said in prose

const SUBJECT = String.raw`(?:I|I'm|I’m|[Hh]e|[Ss]he|[Tt]hey|[Ww]e|[Mm]y \w+|[Hh]is \w+|[Hh]er \w+)`;
const PHRASES: [string, RegExp][] = [
  [
    "health",
    new RegExp(
      String.raw`\b${SUBJECT}\s+(?:was|were|is|am|are|has been|have been|had been|got|gets|get)\s+(?:recently\s+|just\s+|newly\s+|officially\s+)?(?:diagnosed with|treated for|hospitali[sz]ed|admitted to (?:the )?hospital|pregnant|in therapy|in rehab|on antidepressants|undergoing (?:chemo(?:therapy)?|treatment|surgery|dialysis))`,
      "gu",
    ),
  ],
  ["health", new RegExp(String.raw`\b${SUBJECT}\s+(?:suffers?|suffered|is suffering|am suffering)\s+from\b`, "gu")],
  [
    "health",
    /\b(?:[Mm]y|[Hh]is|[Hh]er)\s+(?:diagnosis|prescription|medication|meds|therapist|psychiatrist|oncologist|disability|illness|miscarriage|pregnancy|cancer|diabetes|depression|anxiety|ADHD|autism|HIV)\b/gu,
  ],
  [
    "health",
    /\bdiagnosed with\s+(?:(?:type [12]|early[- ]onset|chronic|severe|stage \w+)\s+)?(?:diabetes|cancer|asthma|adhd|autism|depression|anxiety|bipolar|schizophrenia|hiv|aids|epilepsy|dementia|alzheimer['’]?s|parkinson['’]?s|multiple sclerosis|long covid|covid|leukaemia|leukemia|lymphoma|tumou?r|coeliac|celiac|crohn['’]?s|arthritis|hypertension|heart disease|ptsd|ocd|dyslexia|an? \w+ disorder)/giu,
  ],
  [
    "income",
    /\b[\w-]*(?:salary|income|wages?|compensation|earnings|net_?worth)[\w-]*["']?\s*[:=]\s*["']?[$£€]?\s?\d/giu,
  ],
  [
    "income",
    /\b(?:[Mm]y|[Hh]is|[Hh]er)\s+(?:salary|income|pay|wages?|earnings|pension|rent|mortgage|debt)\s+(?:is|was|of|comes to)\b|\b(?:I|[Hh]e|[Ss]he)\s+(?:earn|earns|earned|make|makes|made)\s+[$£€]?\s?\d/gu,
  ],
  [
    "family",
    /\b[Mm]y\s+(?:wife|husband|partner|spouse|girlfriend|boyfriend|fianc[ée]e?|sons?|daughters?|kids?|children|baby|toddler|mum|mom|mother|dad|father|parents|sister|brother|siblings?|grandma|grandmother|grandpa|grandfather|grandparents|aunt|uncle|cousin|niece|nephew|in-laws?|stepson|stepdaughter|ex-wife|ex-husband)\b(?![-_])/gu,
  ],
  [
    "residence",
    /\b(?:I|We|we)\s+(?:live|lived|am living|are living|reside|am based|are based|grew up)\s+(?:in|near|on|at)\s+(?:the\s+)?(?=\p{Lu})|\b(?:[Mm]y|[Oo]ur)\s+(?:home|house|flat|apartment|address|hometown)\s+(?:is\s+)?(?:in|at|on|near)\s+(?=\p{Lu}|\d)/gu,
  ],
  [
    "employer",
    /\b(?:I|We)\s+(?:work|worked|am working|are working|have worked)\s+(?:at|for)\s+(?=\p{Lu})|\b[Mm]y\s+(?:employer|boss|manager|workplace|day job)\b/gu,
  ],
];

const phrases: Rule = (line) => {
  const out: Finding[] = [];
  for (const [rule, pattern] of PHRASES) {
    for (const match of line.matchAll(pattern)) {
      out.push(finding("other-personal", rule, match.index ?? 0, (match.index ?? 0) + match[0].length));
    }
  }
  return out;
};

// Postal addresses

const STREET_TYPES =
  "Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Close|Row|Way|Drive|Dr|Court|Ct|Place|Pl|Terrace|Crescent|Cres|Gardens|Grove|Hill|Square|Sq|Boulevard|Blvd|Parkway|Pkwy|Highway|Hwy|Mews|Walk|Hollow|Rise|Green|Circle|Cir|Trail|Wharf|Quay";
const STREET = new RegExp(String.raw`(?<![\w.-])\d{1,5}[A-Za-z]?\s+((?:${WORD}\s+){1,3})(?:${STREET_TYPES})\b\.?`, "gu");
const STREET_EU = new RegExp(
  String.raw`(?<![\w-])(?:\p{Lu}\p{Ll}+(?:straße|strasse|weg|gasse|platz|allee|damm|ufer|steig|pfad)|\p{Lu}\p{Ll}+\s+(?:Straße|Strasse|Weg|Gasse|Platz|Allee|Damm|Ufer)|(?:Rue|Avenue|Boulevard|Via|Viale|Calle|Avenida|Rua|Piazza|Chemin|Allée)\s+(?:(?:de|du|des|la|le|del|della|di|da|do|dos)\s+)*${WORD}(?:\s+${WORD})*)\s+\d{1,4}[a-z]?\b`,
  "gu",
);
const STREET_ROMANCE =
  /(?<![\w.-])\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:[Rr]ue|[Aa]venue|[Bb]oulevard|[Cc]hemin|[Aa]llée|[Ii]mpasse|[Qq]uai|[Cc]alle|[Aa]venida|[Rr]ua|[Vv]ia|[Vv]iale|[Pp]iazza|[Cc]orso|[Cc]arrer)\s+(?:(?:de|du|des|la|le|les|l['’]|d['’]|del|della|di|da|do|dos|das)\s*)*\p{Lu}[\p{L}'’-]*/gu;
const STREET_COMMA = new RegExp(
  String.raw`(?:Av\.|Avda\.|Avenida|Rua|Calle|Carrer|Praça|Plaza|Travessa|Alameda)\s+(?:(?:de|da|do|dos|das|del|la)\s+)*${WORD}(?:\s+${WORD})*,\s*(?:n[º°.]?\s*)?\d{1,5}\b`,
  "gu",
);
/** A Japanese address in Latin letters: a chome or a ward or city name, and a postcode. */
const JP_PLACE = /\b\d{1,2}-chome\b|\b\p{Lu}\p{Ll}+-(?:ku|shi)\b/u;
const JP_POSTCODE = /(?<![\w-])\d{3}-\d{4}(?![\w-])/gu;
/** A field whose name says it holds an address, with a value that reads as one. */
const ADDRESS_FIELD =
  /\b(?![\w-]*(?:email|mail|ip|mac|url|web|host|server|listen|bind|remote|local|wallet|contract|memory|base|socket|proxy))[\w-]*(?:address|addr)["']?\s*[:=]\s*["']([^"']*\d[^"']*,[^"']*)["']/giu;
/** Words that make an address a placeholder. */
const PLACEHOLDER_PLACE = /\b(?:fake|example|sample|dummy|placeholder|anytown|nowhere)\w*/i;
const UK_POSTCODE = new RegExp(String.raw`${WORD},?\s+((?:[A-Z]{1,2}\d[A-Z\d]?|GIR)\s?\d[ABD-HJLNP-UW-Z]{2})\b`, "gu");
const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_CITY_ZIP = new RegExp(String.raw`${WORD}(?:\s${WORD})*,\s(?:${US_STATES})\s\d{5}(?:-\d{4})?\b`, "gu");
const PO_BOX = /\bP\.?\s?O\.?\s?Box\s+\d+/giu;

const address: Rule = (line) => {
  const out: Finding[] = [];
  for (const match of line.matchAll(STREET)) {
    if (namesAProduct(match[1])) continue; // a product's word, as in "2 Google Drive"
    out.push(finding("postal-address", "street", match.index ?? 0, (match.index ?? 0) + match[0].length));
  }
  for (const [rule, pattern] of [
    ["street", STREET_EU],
    ["street", STREET_ROMANCE],
    ["street", STREET_COMMA],
    ["postcode", UK_POSTCODE],
    ["postcode", US_CITY_ZIP],
    ["po-box", PO_BOX],
    ["address-field", ADDRESS_FIELD],
  ] as const) {
    for (const match of line.matchAll(pattern)) {
      out.push(finding("postal-address", rule, match.index ?? 0, (match.index ?? 0) + match[0].length));
    }
  }
  if (JP_PLACE.test(line)) {
    for (const match of line.matchAll(JP_POSTCODE)) {
      out.push(finding("postal-address", "postcode", match.index ?? 0, (match.index ?? 0) + match[0].length));
    }
  }
  return out.filter((f) => !PLACEHOLDER_PLACE.test(line.slice(f.start, f.end)));
};

const RULES: Rule[] = [slots, mailboxes, phone, card, iban, ssn, idNumber, birth, phrases, address];

/** Every finding on one line; the context is the lines around it, which only the author field reads. */
export function scan(line: string, context = ""): Finding[] {
  return RULES.flatMap((rule) => rule(line, context));
}

export function kinds(findings: Finding[]): Kind[] {
  return KINDS.filter((kind) => findings.some((f) => f.kind === kind));
}
