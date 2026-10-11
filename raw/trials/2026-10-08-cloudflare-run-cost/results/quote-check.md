# Quotations checked against the documentation text

`bun apparatus/quotes.ts --notes <passages.md> --root <cloudflare-docs>/src/content`, with cloudflare-docs at commit 6e1b96433cf016efd2c0c9057a7e27a8e112376f. A quotation is found when its words, with markdown, quotation marks and white space made alike, are a substring of a file its entry cites. The unit tests hold a positive case (words on the page, with and without markup) and a negative one (a made-up sentence, which is checked and not found).

## cloudflare-containers-sandboxes

129 quotations, 123 in an entry that cites a file of the repository text, 122 of those found in it.

Not found in the cited file (to be read by hand):

- A-ORIENT-1: "Sends `SIGTERM` to the main process in the container. Waits up to 15 minutes for that process to exit. Sends `SIGKILL` if the process is still running."

## cloudflare-control-plane

16 quotations, 15 in an entry that cites a file of the repository text, 15 of those found in it.

## cloudflare-ai-gateway

10 quotations, 10 in an entry that cites a file of the repository text, 10 of those found in it.

A quotation not found is formatting, read by hand: A-ORIENT-1 joins the three items of a numbered list into one sentence, and the page has each item on its own line. The six quotations of the sandboxes capture that sit in no entry citing a file are one from the `containers` library's source (A1.24), one from the Wrangler configuration page, which is not in the repository (A3.9), and four from GitHub, a README and a pull request, read through the GitHub API (A7.7). The user reports in `cloudflare-containers-issue-reports` are issue text and not in the documentation repository, so this check does not cover them. The vendor captures (OpenAI, Anthropic, Meta, Xiaomi and the others) are web pages, so their quotations rest on the two reads their entries record.

A second check ran the other way (`bun apparatus/quotes.ts --page <page.md> --capture <passages.md> ...`): every double-quoted string
of twenty characters or more in the concept page and the source pages, a wrapped quotation read whole, was looked for in the thirteen
passages files. The concept page has 42 and 41 are found; the one not found is the ticket's own title, quoted from the ticket. The
source pages have 29 and all 29 are found. The unit tests hold a positive case, a made-up sentence that must be reported missing, and
a short quotation that must not throw off the pairing of the long one after it.
