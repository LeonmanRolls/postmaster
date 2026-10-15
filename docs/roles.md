# The four roles

| role | does | never does |
|---|---|---|
| **postmaster** | splits a stream into tickets, dispatches one coachman per ticket, supervises, answers escalations, grants merges | run a model lane, edit source |
| **booking clerk** | prepares one ticket with the user and marks it ready after sign-off | dispatch, edit the target repository |
| **coachman** | drives one leg of a ticket; at most two legs, synthesis and review, each a fresh coachman, carry it from waybill to ship card with a written hand-off between them; the last leg ends the run ready for merge | take a second leg, merge |
| **the team** | several lanes implementing the same ticket in blinkers | see each other's work |

Back to the [README](../README.md).
