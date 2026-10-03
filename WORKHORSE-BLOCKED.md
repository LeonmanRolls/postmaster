# WORKHORSE-BLOCKED

## Check

C8, the main-history census, exceeds its approved limit. The full-history scan from the empty tree through `origin/main` returned 73 rule rows representing 66 distinct places after deduplication by file, line, and commit. The limit is 50 suspects. The primary-rule counts are account-id 11, dotenv 5, email 20, key 5, private-host 4, private-path 13, and token 8.

No rule was weakened. D18 requires a user ruling when the census exceeds 50. The scan transcript is `.postmaster/verify/C8-census.txt`; raw findings remain in the local verification directory and are not included here.

## Proposed change

Keep the scanner rules and raise C8's limit for this baseline to at least 66. Then record and classify all suspects and include their counts on the ship card. No history filter or rule change has been applied.

## Branch state

Branch `wb/216-luna` has two implementation commits. The scanner, gate wiring, run-status reporting, card checks, runbooks, and fixture cleanup are committed. C8 and the remaining final verification checks are not complete. Nothing has been pushed.
