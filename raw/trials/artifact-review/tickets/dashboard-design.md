## Problem / feature
The dashboard (#146 to #150, designed in #126) is not built yet. The user wants to settle how it looks and feels before any of its features are built, by trying working prototypes on their phone and iPad rather than reading a design. In #214's research a clickable page with sample data was changed in minutes and tried on both devices, and the user shaped a review page that way in one sitting. Different models design differently, and the user wants each model's own take to choose from.

## Acceptance criteria
1. Each model the machine has builds its own clickable web prototype of the dashboard, at its harness's top effort level and unable to see the others' work: Claude Opus 5.5, Claude Sonnet 5.5, codex with GPT-6 Sol, MiMo V2.6 Pro and Muse Spark. Check: there is one prototype per model, each made in a folder of its own, with the model and its effort recorded beside it.
2. Each prototype covers the home page, with runs sorted by who acts next; a run's page; and the change page from #214, with the ticket, the spec, the change's summary, the diff and the files as they stand, where a tap on a line copies its reference for the chat. All of it runs on made-up sample data that names no real machine, path or person. Check: in every prototype the user can tap from the home page to a run and on to its change.
3. Each prototype follows the dashboard's rules in `wiki/concepts/dashboard.md`: it only shows, its layout follows the window's width at the widths that page names, and every control works by touch. Check: each opens at phone width with no sideways scroll, and on the iPad it uses the extra width.
4. Each prototype is published as a private artifact page, and the user gets one link per model. Check: every link opens on the user's phone and iPad, and none is shared.
5. The user says what to keep from each prototype, and the session records it. Check: a design record, in the wiki or on #146, names what was chosen, from which prototype, and why, in the user's words.

## Direction
An interactive design session with the user steering, as research tickets have (#99), not a run that synthesizes: no model merges the prototypes, the user chooses. The models work from the same brief, each in its own folder. The session publishes each prototype, since only Claude Code can publish an artifact. The prototypes are throwaway pages: nothing is built into the repository, and the dashboard's rules from #126 hold, read-only included.

## Turnpikes
none

## Notes
The user's word on 2026-10-03, in #214's session: "I want multiple models to come up with a design, every model have available should come up with one, at max effort. They should be clickable webapp prototypes." The change page and its comments-to-chat choice come from #214, where the user chose to make the review page a page of the dashboard rather than its own app with a way to write. Related: #126, #146, #147, #214.
