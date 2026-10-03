/**
 * The 71 made-up lines of the Jev trial's last version (`../../jev-pii/apparatus/pii_jev.py`,
 * `corpus()` under v6), in the same order and built from the same fragments, so that no value a
 * check would find sits whole in this file. `identity` in run.ts checks the two give the same text.
 * A label is the kind a line holds, or "" for a hard negative.
 */

export interface Item {
  label: string;
  text: string;
}

const n = (...parts: string[]): string => parts.join("");
const at = "@";

export function corpus(): Item[] {
  const rows: [string, string][] = [
    ["person", n("Thanks to Ingrid ", "Halvorsen-Mbeki for reporting the crash.")],
    ["person", n("Assigned to Tomasz ", "Wierzbicki-Lund; he is back on Monday.")],
    ["person", n('author = "Priyanka ', 'Venkataraman-Oduya"')],
    ["person", n('{"display_name": "', n("Kofi ", "Annorbah-Sarpei"), '", "role": "admin"}')],
    ["person", n("D", "r. Henrietta ", "Okonkwo-Baptiste reviewed the scan results.")],
    ["person", n("Signed-off-by: Mateus ", "Albuquerque-Ferreira")],
    ["person", n("# Maintainer: Ewa ", "Kwiatkowska-Ruiz")],
    ["person", n('{"text": "', n("my na", "me is Yusuf ", "Demirci-Hallam and I run the bakery on the corner"), '"}')],
    ["person", n("Meeting notes: Lars, Aiko ", "Watanabe-Price and I agreed on the date.")],
    ["person", n("The landlord, M", "r Desmond ", "Achterberg-Ngata, wants the deposit by Friday.")],
    ["email", n("Contact: ingrid.halvorsen", at, "fjordmail-413.net")],
    ["email", n("Send the logs to tomasz.w.lund", at, "quietharbour-413.net.")],
    ["email", n('{"from": "', n("kofi.annorbah", at, "postbox-413.org"), '"}')],
    ["email", n("cc: priyanka.v.oduya", at, "inbox-413.io")],
    ["phone", n("Call me on +44 77", "00 900", "461 after six.")],
    ["phone", n("Her mobile is (555) 010-", "4477.")],
    ["phone", n("Tel: 0161 496 ", "0738")],
    ["phone", n("WhatsApp +1 202 555 ", "0143 about the keys.")],
    ["phone", n('phone_number = "+61 49', '1 570 ', '156"')],
    ["postal-address", n("Ship it to 7 Wren Cl", "ose, ", "Fallowmere FM", "3 2QT.")],
    ["postal-address", n("Her flat is at 48 Larkspur R", "ow, ", "Apartment 5B, Thistlecombe.")],
    ["postal-address", n('{"address": "', n("1180 Juniper Hol", "low ", "Road, Cedar Falls"), '"}')],
    ["postal-address", n("We moved to Kastanienw", "eg 12, ", "99999 Beispielstadt last month.")],
    ["other-personal", n("Her date of bi", "rth is 14 March 1987.")],
    ["other-personal", n("SSN 900-12-", "3456 is on the form.")],
    ["other-personal", n("Card 4000 0566 5566 ", "5556 expires 09/29.")],
    ["other-personal", n("IBAN GB3", "3 BUKB 2020 1555 ", "5555 55 for the refund.")],
    ["other-personal", n("He was diag", "nosed with type 1 diabetes in March, so he skips the dinner.")],
    ["other-personal", n("Pass", "port X12", "34567 expires next year.")],
    ["other-personal", n("Her sal", "ary is 84,000 a year and she rents the flat from her brother.")],
    ["", "Linus Torvalds merged the scheduler change in 2007."],
    ["", "Ada Lovelace wrote the first published algorithm."],
    ["", "Alice sends Bob the session key in the protocol diagram."],
    ["", n('const user = { name: "Jane Doe", em', "ail: ", '"jane', at, 'example.com" };')],
    ["", "John Smith is the default author in the fixture template."],
    ["", "Install @huggingface/transformers and run the pipeline."],
    ["", "Claude Code supports a --model flag."],
    ["", "The Herdr pane shows the agent as idle."],
    ["", n("Report problems to support", at, "github.com.")],
    ["", "Set `author_email` in the config file."],
    ["", "Version 10.20.30 fixes the parser."],
    ["", "The job ran at 2026-10-01 12:30:45 UTC."],
    ["", "Listen on port 8080 and retry after 300 ms."],
    ["", "The commit 89abcdef0123 introduced the bug."],
    ["", "Main Street is the name of the demo dataset."],
    ["", "The release date is 14 March 2027."],
    ["", "Our office is open from 9 to 5 on weekdays."],
    ["", "Use the test card number from the payment provider's docs."],
    ["", "The patient record schema has a diagnosis field."],
    ["", "A UUID such as 123e4567-e89b-12d3-a456-426614174000 identifies the job."],
    ["", "The Kubernetes maintainers released 1.31 last week."],
    ["", "Thanks to everyone who reported the crash."],
    ["", n("Sherlock Holmes lives at 221B Baker Str", "eet in the stories.")],
    ["", "Contact the maintainers through the issue tracker."],
    ["", "The model was trained by OpenAI and Anthropic researchers."],
    ["", "Call the support line on 1-800-555-0199 during office hours."],
    ["", "brindlewick maintains this project."],
    ["", "The GitHub user octocat opened the issue."],
    ["", "Rename the helper to match the others."],
    ["", "The form's phone field accepts up to fifteen digits."],
    ["", "The coachman harvests both lanes before the review."],
    ["", "luna and mimo reviewed the change in round two."],
    ["", "Petersson and others (2004) measured capture-recapture in software inspections."],
    ["", "Herdr reports the pane as idle when Claude finishes its turn."],
    ["person", n("Ingrid from the support desk said M", "rs Halvorsen-", "Mbeki can be reached at home.")],
    ["", "Al Haddad, Ikram, Ahmed and Lee, a preprint of October 2025."],
    ["", "reviewers: luna, mimo"],
    ["person", n("Luna ", "Okafor-Brandt asked for the refund in person.")],
    ["", n("auth", "or: Mirela Van", "tongeren, Kwabena Osei-Fairweather")],
    ["person", n('"au', 'thor": "Bronagh ', 'Treloar-Sandoval",')],
    ["person", n("Copyright (c) 2026 Bronagh ", "Treloar-Sandoval")],
  ];
  return rows.map(([label, text]) => ({ label, text }));
}

/** The lines around five corpus lines, as the Jev trial gave them to its citation question. */
export function corpusContext(): Map<string, string> {
  return new Map([
    [n('author = "Priyanka ', 'Venkataraman-Oduya"'), '[package]\nname = "fernhill"\nversion = "0.3.1"\nlicense = "MIT"'],
    [
      "Al Haddad, Ikram, Ahmed and Lee, a preprint of October 2025.",
      '---\ntitle: "Evaluating models for vulnerability triage and prioritization (Al Haddad, Ikram, Ahmed and ' +
        'Lee, 2025)"\nsources: [papers/al-haddad-2025-vulnerability-triage]\n---',
    ],
    [
      n("auth", "or: Mirela Van", "tongeren, Kwabena Osei-Fairweather"),
      'title: "Measuring review latency in open-source projects"\n' +
        "url: https://example.org/papers/review-latency.pdf\nretrieved: 2026-10-01",
    ],
    [n('"au', 'thor": "Bronagh ', 'Treloar-Sandoval",'), '{\n  "name": "fernhill-cli",\n  "version": "1.2.0",\n  "license": "MIT",'],
    [
      n("Copyright (c) 2026 Bronagh ", "Treloar-Sandoval"),
      "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy",
    ],
  ]);
}

/** Ten plain lines, the control: nothing on them is personal data. */
export const CLEAN = [
  "The cache expires after ten minutes.",
  "Run the tests before you push.",
  "The parser now accepts trailing commas.",
  "Logging moves to its own module.",
  "The flag defaults to off.",
  "Retry twice, then give up.",
  "The table sorts by date, newest first.",
  "Remove the unused import.",
  "The release notes list three fixes.",
  "The build takes about a minute.",
];
