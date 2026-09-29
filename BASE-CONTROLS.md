# BASE self-test controls

Controls below are copied from the self-test assertions at BASE `bb782a973e69427c820ce16a676718e87f51995b`. The TypeScript port column names the matching assertion that must remain in that script’s self-test. Dynamic labels are recorded as their call site expression.

## cut-scratch.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| a worktree scratch is cut at the snapshot, with its dependencies cloned | a worktree scratch is cut at the snapshot, with its dependencies cloned |
| a clone scratch is cut at the snapshot, with its dependencies cloned | a clone scratch is cut at the snapshot, with its dependencies cloned |
| in it, the diff against origin/HEAD is exactly the change from the base | in it, the diff against origin/HEAD is exactly the change from the base |
| and it copied no objects | and it copied no objects |
| --kind names each scratch and the repository it was cut from | --kind names each scratch and the repository it was cut from |
| $tmp/clone | $tmp/clone |
| --check passes a clone at the snapshot whose origin/HEAD leads back to the base | --check passes a clone at the snapshot whose origin/HEAD leads back to the base |
| $tmp/wt | $tmp/wt |
| and a worktree at the snapshot | and a worktree at the snapshot |
| with main moved on by another run's merge, a clone still reviews from the base | with main moved on by another run's merge, a clone still reviews from the base |
| --remove takes a worktree scratch away through git | --remove takes a worktree scratch away through git |
| --remove takes a clone scratch away | --remove takes a clone scratch away |
| $tmp/moved | $tmp/moved |
| --check refuses a scratch that is not at the snapshot | --check refuses a scratch that is not at the snapshot |
| $tmp/wt2 | $tmp/wt2 |
| and a worktree where a clone is needed | and a worktree where a clone is needed |
| $tmp/moved | $tmp/moved |
| and a clone whose origin/HEAD does not lead back to the base | and a clone whose origin/HEAD does not lead back to the base |
| a clone whose origin/HEAD does not lead back to the base is refused, and removed | a clone whose origin/HEAD does not lead back to the base is refused, and removed |
| so is one cut while the repository has an unrelated branch checked out | so is one cut while the repository has an unrelated branch checked out |
| a base the repository does not have is refused, and nothing is cut | a base the repository does not have is refused, and nothing is cut |
| a dest that already exists is refused, and left alone | a dest that already exists is refused, and left alone |
| for a worktree scratch too | for a worktree scratch too |
| --kind: $(basename  | --kind: $(basename  |
| --remove refuses it, and leaves it | --remove refuses it, and leaves it |
| the synthesis worktree is untouched | the synthesis worktree is untouched |
| --remove refuses a scratch of another repository | --remove refuses a scratch of another repository |
| --clone with no base is a usage error | --clone with no base is a usage error |
| [dynamic label] | [dynamic label] |
## fixture.sh

| BASE control | TypeScript port |
|---|---|
| there are at least two tickets | there are at least two tickets |
| $t: in the ticket shape, by scripts/ticket-check.sh | $t: in the ticket shape, by scripts/ticket-check.sh |
| $t: the reference solution applies to the app | $t: the reference solution applies to the app |
| $t: the hidden suite fails on the app as committed | $t: the hidden suite fails on the app as committed |
| $t: the hidden suite passes on the reference solution | $t: the hidden suite passes on the reference solution |
| new makes the repo and prints the ticket's number | new makes the repo and prints the ticket's number |
| one commit on main, and a clean tree | one commit on main, and a clean tree |
| it holds the app's files as git sees them, symlink included, and nothing else | it holds the app's files as git sees them, symlink included, and nothing else |
| it commits as this checkout does | it commits as this checkout does |
| it has no remote | it has no remote |
| its own store holds the fixture ticket, title and body verbatim, in todo | its own store holds the fixture ticket, title and body verbatim, in todo |
| a run against it reads the local tracker, though the config names github | a run against it reads the local tracker, though the config names github |
| no hidden test and no reference solution reached it | no hidden test and no reference solution reached it |
| a dest that exists is refused, and left alone | a dest that exists is refused, and left alone |
| a dest inside a git repo is refused | a dest inside a git repo is refused |
| a name that already has runs is refused | a name that already has runs is refused |
| a name that is this repo's is refused | a name that is this repo's is refused |
| an unknown ticket is refused | an unknown ticket is refused |
| a ticket that cannot be filed: refused, and the repo it made is gone | a ticket that cannot be filed: refused, and the repo it made is gone |
| a bare name goes under ~/Code/fixtures, not the working directory | a bare name goes under ~/Code/fixtures, not the working directory |
| POSTMASTER_FIXTURES moves where a bare name goes | POSTMASTER_FIXTURES moves where a bare name goes |
| the hand-off sections and the stages are read from the scripts that define them | the hand-off sections and the stages are read from the scripts that define them |
| $1 | $1 |
| a clean run on $t: every check passes | a clean run on $t: every check passes |
| the app shipped as committed: hidden-tests alone fails, and the app's own gate passes | the app shipped as committed: hidden-tests alone fails, and the app's own gate passes |
| the waybill does not carry the ticket: hidden-tests alone fails | the waybill does not carry the ticket: hidden-tests alone fails |
| a type error shipped: gate alone fails | a type error shipped: gate alone fails |
| a stage change never logged: stages alone fails | a stage change never logged: stages alone fails |
| a leg's done marker missing: markers alone fails | a leg's done marker missing: markers alone fails |
| a hand-off with no sections: handoffs alone fails | a hand-off with no sections: handoffs alone fails |
| no run.json: run.json alone fails | no run.json: run.json alone fails |
| no ship card: ship-card alone fails | no ship card: ship-card alone fails |
| no such dispatch directory | no such dispatch directory |
| a repo that is not a git repo | a repo that is not a git repo |
| a repo whose main does not hold the run's base | a repo whose main does not hold the run's base |
| [dynamic label] | [dynamic label] |

## front-door-acceptance.sh

| BASE control | TypeScript port |
|---|---|
| [dynamic label] | [dynamic label] |
| [dynamic label] | [dynamic label] |
| [dynamic label] | [dynamic label] |
| stale tree exits 1\n | stale tree exits 1\n |
| stale tree lists 19 faults\n | stale tree lists 19 faults\n |
| clean tree passes\n | clean tree passes\n |
| missing tree exits 2\n | missing tree exits 2\n |
| an extra argument exits 2\n | an extra argument exits 2\n |
| --self-test with an extra argument exits 2\n | --self-test with an extra argument exits 2\n |
| a CRLF stale sentence is still caught\n | a CRLF stale sentence is still caught\n |
| an unreadable file exits 2, not a clean result\n | an unreadable file exits 2, not a clean result\n |
| live tree passes\n | live tree passes\n |

## front-door.sh

| BASE control | TypeScript port |
|---|---|
| $label | $label |
| $label | $label |
| $label | $label |
| all four failing names $reason | all four failing names $reason |
| reasons print in ticket order | reasons print in ticket order |
| and refuses in its own words, with no traceback | and refuses in its own words, with no traceback |
| and says control characters | and says control characters |
| and says so | and says so |
| [dynamic label] | [dynamic label] |

## github.sh

| BASE control | TypeScript port |
|---|---|
| read --body prints the stored body byte for byte, then one newline | read --body prints the stored body byte for byte, then one newline |
| read --body keeps a CRLF body's line endings | read --body keeps a CRLF body's line endings |
| read without --body still prints the header before the body | read without --body still prints the header before the body |
| edit against the body as read calls gh issue edit once, with the body file and no title | edit against the body as read calls gh issue edit once, with the body file and no title |
| a body stored with CRLF matches the same base with LF | a body stored with CRLF matches the same base with LF |
| $label | $label |
| read --body without a linked board exits 3 | read --body without a linked board exits 3 |
| access prints the user's permission | access prints the user's permission |
| a repository the user only reads says READ | a repository the user only reads says READ |
| a repository gh cannot see exits 1 | a repository gh cannot see exits 1 |
| create files the issue and prints its number | create files the issue and prints its number |
| an issue that misses the board still prints its number, and exits 5 | an issue that misses the board still prints its number, and exits 5 |
| a board with no Todo column is refused before anything is created | a board with no Todo column is refused before anything is created |
| search asks for the phrase in this repository, and prints number, state and title | search asks for the phrase in this repository, and prints number, state and title |
| a colon in the text is searched as a space, which GitHub's query accepts | a colon in the text is searched as a space, which GitHub's query accepts |
| [dynamic label] | [dynamic label] |

## host.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| a Herdr server that answers is the host | a Herdr server that answers is the host |
| with no Herdr server answering, tmux is | with no Herdr server answering, tmux is |
| with neither on PATH, none | with neither on PATH, none |
| POSTMASTER_HOST=none wins over a live Herdr | POSTMASTER_HOST=none wins over a live Herdr |
| POSTMASTER_HOST=tmux wins over a live Herdr | POSTMASTER_HOST=tmux wins over a live Herdr |
| it is the Dispatch section's name, then the role | it is the Dispatch section's name, then the role |
| a waybill without one falls back to the run's directory | a waybill without one falls back to the run's directory |
| control characters never reach a label | control characters never reach a label |
| it says it ran in the background | it says it ran in the background |
| stdout and stderr are byte for byte a direct run's | stdout and stderr are byte for byte a direct run's |
| and the title's shell syntax never ran | and the title's shell syntax never ran |
| an earlier launch's marker is gone once run returns | an earlier launch's marker is gone once run returns |
| and it lands again when this one exits, whatever its exit | and it lands again when this one exits, whatever its exit |
| it runs from the caller's directory, with the caller's environment and its name | it runs from the caller's directory, with the caller's environment and its name |
| but never with its caller's pane | but never with its caller's pane |
| it is a session of its own: its group is its pid, not the caller's session | it is a session of its own: its group is its pid, not the caller's session |
| --pidfile holds the launch's pid | --pidfile holds the launch's pid |
| and it is there, for a live process, the moment run returns | and it is there, for a live process, the moment run returns |
| --append keeps what the stream held, and --err holds only this launch's errors | --append keeps what the stream held, and --err holds only this launch's errors |
| a command without -- is refused, and its marker lands | a command without -- is refused, and its marker lands |
| a directory that does not exist: refused, the marker lands and --err says why | a directory that does not exist: refused, the marker lands and --err says why |
| a count that is not a whole number is refused, and never reaches the tests | a count that is not a whole number is refused, and never reaches the tests |
| the same for wait | the same for wait |
| stop reaches a child the launch runs in a session of its own | stop reaches a child the launch runs in a session of its own |
| the launch got TERM first, and a child deaf to it is killed after the wait | the launch got TERM first, and a child deaf to it is killed after the wait |
| its marker lands | its marker lands |
| a process that works in the worktree but that no launch started is left alone | a process that works in the worktree but that no launch started is left alone |
| it says where it ran | it says where it ran |
| a repository with no space gets one first, labelled with its name | a repository with no space gets one first, labelled with its name |
| the worktree opens as a space under it, labelled with the launch's name | the worktree opens as a space under it, labelled with the launch's name |
| host.sh marks the space it opened as its own | host.sh marks the space it opened as its own |
| the launch ran in that pane, with that pane's identity | the launch ran in that pane, with that pane's identity |
| and with its caller's environment, handed over by host.sh | and with its caller's environment, handed over by host.sh |
| the pane shows the name and the rendered stream, not raw JSON | the pane shows the name and the rendered stream, not raw JSON |
| and reports the launch working, then releases it | and reports the launch working, then releases it |
| a second launch in the same worktree is a new tab in the same space | a second launch in the same worktree is a new tab in the same space |
| the stream and the marker are what a background run writes | the stream and the marker are what a background run writes |
| a pane closed mid-run: the launch stops, and its marker lands | a pane closed mid-run: the launch stops, and its marker lands |
| its runner and the launch killed outright: the marker still lands | its runner and the launch killed outright: the marker still lands |
| a pane that never starts the launch: it runs in the background instead | a pane that never starts the launch: it runs in the background instead |
| a pane that starts it late: it still runs exactly once | a pane that starts it late: it still runs exactly once |
| no launch leaves its hand-over directory behind | no launch leaves its hand-over directory behind |
| a space host.sh opened, its launches done, is closed | a space host.sh opened, its launches done, is closed |
| the repository's own checkout is refused | the repository's own checkout is refused |
| a space host.sh did not open is refused, and left open | a space host.sh did not open is refused, and left open |
| a launch that fell back to the background still holds its worktree: close refuses | a launch that fell back to the background still holds its worktree: close refuses |
| stop refuses to run from inside the worktree it would stop | stop refuses to run from inside the worktree it would stop |
| stop ends it, and its marker lands | stop ends it, and its marker lands |
| then close closes the space | then close closes the space |
| it opens as a space of the launch's own, labelled with its name, and no other | it opens as a space of the launch's own, labelled with its name, and no other |
| host.sh marks that space as its own | host.sh marks that space as its own |
| a second launch there is a new tab in the same space | a second launch there is a new tab in the same space |
| close shuts it | close shuts it |
| a plain clone is no scratch: it opens as a repository, and close refuses its space | a plain clone is no scratch: it opens as a repository, and close refuses its space |
| a first launch opens session postmaster-<repo>, a window named for it | a first launch opens session postmaster-<repo>, a window named for it |
| the launch ran with that window's pane and its caller's environment | the launch ran with that window's pane and its caller's environment |
| the next is a window in the same session | the next is a window in the same session |
| close refuses while a launch still runs in the worktree | close refuses while a launch still runs in the worktree |
| once it is stopped, close kills that worktree's windows | once it is stopped, close kills that worktree's windows |
| a reviewer's scratch clone gets a window in the session of the repository it was cut from | a reviewer's scratch clone gets a window in the session of the repository it was cut from |
| and close kills it | and close kills it |
| with no host, spawn, send and read say so, exit 3 | with no host, spawn, send and read say so, exit 3 |
| Herdr: spawn starts the agent in a tab of the repository's own space | Herdr: spawn starts the agent in a tab of the repository's own space |
| with the caller's POSTMASTER_ settings in its pane | with the caller's POSTMASTER_ settings in its pane |
| a handle a live agent already has is refused | a handle a live agent already has is refused |
| a harness asking something on first start: spawn says so, and does not fail | a harness asking something on first start: spawn says so, and does not fail |
| a handle becomes a Herdr agent name: lowercase, no dots or spaces | a handle becomes a Herdr agent name: lowercase, no dots or spaces |
| two long names that share a start get two handles, each always the same, none over 32 | two long names that share a start get two handles, each always the same, none over 32 |
| Herdr: send submits the file's text as the agent's prompt | Herdr: send submits the file's text as the agent's prompt |
| Herdr: send --wait sends and waits in one call, never a prompt then a wait | Herdr: send --wait sends and waits in one call, never a prompt then a wait |
| a turn that stops at an approval or a question is not settled: exit 3 | a turn that stops at an approval or a question is not settled: exit 3 |
| Herdr: wait and read go to the agent by its handle | Herdr: wait and read go to the agent by its handle |
| tmux: spawn passes the caller's POSTMASTER_ settings to the window | tmux: spawn passes the caller's POSTMASTER_ settings to the window |
| tmux: send pastes bracketed, then presses Enter as its own key | tmux: send pastes bracketed, then presses Enter as its own key |
| tmux: wait settles on a quiet screen, and read takes the lines asked for | tmux: wait settles on a quiet screen, and read takes the lines asked for |
| the launch runs in Herdr | the launch runs in Herdr |
| in a pane of its own worktree's space | in a pane of its own worktree's space |
| that space is a linked worktree of the repository, whose own space is its parent | that space is a linked worktree of the repository, whose own space is its parent |
| the space and the tab carry the launch's name, shell syntax and all, as written | the space and the tab carry the launch's name, shell syntax and all, as written |
| while it runs, the pane is working and its terminal title is the name | while it runs, the pane is working and its terminal title is the name |
| its marker lands | its marker lands |
| its stream and errors are what a direct run writes | its stream and errors are what a direct run writes |
| the pane shows one line per event, not raw JSON | the pane shows one line per event, not raw JSON |
| and the launch is released when it ends | and the launch is released when it ends |
| the launch has no terminal, and a group of its own | the launch has no terminal, and a group of its own |
| closing a launch's pane mid-run stops it, and its marker still lands | closing a launch's pane mid-run stops it, and its marker still lands |
| a detached reviewer scratch opens as a space too | a detached reviewer scratch opens as a space too |
| a reviewer's scratch clone opens as a space of its own | a reviewer's scratch clone opens as a space of its own |
| and close shuts it | and close shuts it |
| close refuses the repository's own space | close refuses the repository's own space |
| close shuts the worktree's space, and only that | close shuts the worktree's space, and only that |
| and the reviewer's | and the reviewer's |
| the same launch runs in the background | the same launch runs in the background |
| no space opens for it | no space opens for it |
| its marker lands | its marker lands |
| its stream and errors are the same | its stream and errors are the same |
| the launch runs in a window of session postmaster-<repo>, named for it | the launch runs in a window of session postmaster-<repo>, named for it |
| its marker lands | its marker lands |
| its stream and errors are the same | its stream and errors are the same |
| close kills the worktree's window | close kills the worktree's window |
| [dynamic label] | [dynamic label] |

## launch.sh

| BASE control | TypeScript port |
|---|---|
| $label | $label |
| $label | $label |
| $label | $label |
| $label | $label |
| $label | $label |
| $label | $label |
| a runbook launch or resume with no --run is found, fenced or inline | a runbook launch or resume with no --run is found, fenced or inline |
| no launch or resume in coachman.md or postmaster.md lacks --run <dispatch> | no launch or resume in coachman.md or postmaster.md lacks --run <dispatch> |
| $label | $label |
| a muse launch: JSON events, the prompt file, model, effort, bypass form and env file, nothing on stdin, and its own data directory | a muse launch: JSON events, the prompt file, model, effort, bypass form and env file, nothing on stdin, and its own data directory |
| a muse resume names the session, keeps the model and effort, and finds the launch's data directory | a muse resume names the session, keeps the model and effort, and finds the launch's data directory |
| another lane, each coachman leg, and the same lane elsewhere each get a data directory of their own | another lane, each coachman leg, and the same lane elsewhere each get a data directory of their own |
| a relative prompt file is made absolute before the cd, and no effort means no effort flag | a relative prompt file is made absolute before the cd, and no effort means no effort flag |
| a muse coachman resumes its thread on the leg it was launched on | a muse coachman resumes its thread on the leg it was launched on |
| a mimo launch: JSON events, model, variant, bypass form, env file, the prompt on stdin, its own data directory, and no history import | a mimo launch: JSON events, model, variant, bypass form, env file, the prompt on stdin, its own data directory, and no history import |
| a mimo resume names the session, keeps the model and the variant, and finds the launch's data directory | a mimo resume names the session, keeps the model and the variant, and finds the launch's data directory |
| another mimo lane in the same directory gets a data directory of its own | another mimo lane in the same directory gets a data directory of its own |
| a relative prompt file is read after the cd, no effort means no variant, and a launch is titled after its run | a relative prompt file is read after the cd, no effort means no variant, and a launch is titled after its run |
| a mimo lane has no security review skill: exit 3 | a mimo lane has no security review skill: exit 3 |
| $name: the launch and resume forms both carry $flag | $name: the launch and resume forms both carry $flag |
| $name: a form without $flag fails this check | $name: a form without $flag fails this check |
| $name: a resume form without $flag fails this check | $name: a resume form without $flag fails this check |
| a claude lane's security review skill is /security-review | a claude lane's security review skill is /security-review |
| a harness with no security review skill is exit 3, never a prompt | a harness with no security review skill is exit 3, never a prompt |
| a muse lane has no security review skill: exit 3 | a muse lane has no security review skill: exit 3 |
| [dynamic label] | [dynamic label] |
| [dynamic label] | [dynamic label] |

## link-skills.sh

| BASE control | TypeScript port |
|---|---|
| each skill is a link from claude's folder and from ~/.agents/skills to the checkout | each skill is a link from claude's folder and from ~/.agents/skills to the checkout |
| nothing else is made, for a harness not installed or with no skills folder | nothing else is made, for a harness not installed or with no skills folder |
| harnesses that read one folder get one link there | harnesses that read one folder get one link there |
| a harness with no skills folder is named with the absolute path its brief gives | a harness with no skills folder is named with the absolute path its brief gives |
| nothing in a skills folder is a copy | nothing in a skills folder is a copy |
| running it again changes nothing | running it again changes nothing |
| claude's folder moves with CLAUDE_CONFIG_DIR | claude's folder moves with CLAUDE_CONFIG_DIR |
| SKILL.md documents how <tool> is found, and trackers.md the board command | SKILL.md documents how <tool> is found, and trackers.md the board command |
| <tool> is the checkout the link leads to | <tool> is the checkout the link leads to |
| the board command runs through the link | the board command runs through the link |
| a session in the checkout itself, sent to skills/postmaster, finds that checkout | a session in the checkout itself, sent to skills/postmaster, finds that checkout |
| $1 | $1 |
| $1 | $1 |
| a refusal makes no other link either | a refusal makes no other link either |
| --dry-run names the links it would make, and makes none | --dry-run names the links it would make, and makes none |
| counts as linked, and nothing is written into the checkout | counts as linked, and nothing is written into the checkout |
| --remove leaves it, and the checkout, alone | --remove leaves it, and the checkout, alone |
| its own links go; a link elsewhere and a real folder stay | its own links go; a link elsewhere and a real folder stay |
| from a worktree: the main checkout, never the worktree | from a worktree: the main checkout, never the worktree |
| from the main checkout: itself | from the main checkout: itself |
| from a tree outside git, such as an installed package: itself | from a tree outside git, such as an installed package: itself |
| from a package inside another project's checkout: the package, not the project | from a package inside another project's checkout: the package, not the project |
| a bare main checkout is refused | a bare main checkout is refused |
| harnesses.md has a Skills folders table | harnesses.md has a Skills folders table |
| $h: ${want:-no skills folder} | $h: ${want:-no skills folder} |
| [dynamic label] | [dynamic label] |

## local.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| $label | $label |
| store says there is none, exit 3, and names store init | store says there is none, exit 3, and names store init |
| $label exits 3 | $label exits 3 |
| store init from a linked worktree is refused, and names the main checkout | store init from a linked worktree is refused, and names the main checkout |
| and none of them made a store | and none of them made a store |
| a directory that is not a git repository exits 1 | a directory that is not a git repository exits 1 |
| store init from the main checkout makes the store in the repository's git directory | store init from the main checkout makes the store in the repository's git directory |
| store init on an empty store leaves it as it was | store init on an empty store leaves it as it was |
| the main checkout, a directory in it and a linked worktree find the same store | the main checkout, a directory in it and a linked worktree find the same store |
| create prints the new ticket's number, 1 | create prints the new ticket's number, 1 |
| the next create prints 2 | the next create prints 2 |
| read --body prints the body byte for byte | read --body prints the body byte for byte |
| a CRLF body keeps its line endings | a CRLF body keeps its line endings |
| read prints id, title, state, labels, created and path, a blank line, then the body | read prints id, title, state, labels, created and path, a blank line, then the body |
| a linked worktree and a subdirectory read the same ticket | a linked worktree and a subdirectory read the same ticket |
| a state set from a linked worktree is the state the main checkout reads | a state set from a linked worktree is the state the main checkout reads |
| comment adds one dated line to the log, actor first, on one line | comment adds one dated line to the log, actor first, on one line |
| edit against the body as read replaces it | edit against the body as read replaces it |
| the body is the new one, and the title and state are as they were | the body is the new one, and the title and state are as they were |
| a base that differs only in line endings and trailing spaces matches | a base that differs only in line endings and trailing spaces matches |
| title replaces the title | title replaces the title |
| and leaves the body and state as they were | and leaves the body and state as they were |
| list groups every ticket by state, in the flow's order, then by number | list groups every ticket by state, in the flow's order, then by number |
| list <state> lists only that state | list <state> lists only that state |
| store init on a store holding tickets changes none of them | store init on a store holding tickets changes none of them |
| create drops a body's byte-order mark | create drops a body's byte-order mark |
| read shows the first heading of a body that gained a byte-order mark | read shows the first heading of a body that gained a byte-order mark |
| create takes its body from /dev/stdin | create takes its body from /dev/stdin |
| edit takes its body from /dev/stdin | edit takes its body from /dev/stdin |
| edit takes its base from /dev/stdin | edit takes its base from /dev/stdin |
| no ticket is in a working tree, on a branch or in a commit | no ticket is in a working tree, on a branch or in a commit |
| ten creates at once get ten different numbers | ten creates at once get ten different numbers |
| a GIT_DIR from the caller does not steer it to another repository | a GIT_DIR from the caller does not steer it to another repository |
| an exported CDPATH does not move a relative <repo> | an exported CDPATH does not move a relative <repo> |
| a symlink to a directory in the repository finds its store, not the store of the repository holding the link | a symlink to a directory in the repository finds its store, not the store of the repository holding the link |
| modules in the target's own directory are never imported | modules in the target's own directory are never imported |
| no command called gh | no command called gh |
| list prints the tickets it can read, names the one it cannot, and exits 1 | list prints the tickets it can read, names the one it cannot, and exits 1 |
| a log that is not a list is refused, not split into characters | a log that is not a list is refused, not split into characters |
| labels that are not a list are refused | labels that are not a list are refused |
| a ticket file saved with a byte-order mark still reads | a ticket file saved with a byte-order mark still reads |
| a lane's worktree cannot make its repository a store | a lane's worktree cannot make its repository a store |
| store remove on a store that holds no ticket removes it | store remove on a store that holds no ticket removes it |
| and the repository is back on the config's kind | and the repository is back on the config's kind |
| discover-project.sh names local for it and its worktree, with a config naming github | discover-project.sh names local for it and its worktree, with a config naming github |
| a repository with no store gets the config's kind, and none without a config | a repository with no store gets the config's kind, and none without a config |
| a store that cannot be looked for is not taken for no store | a store that cannot be looked for is not taken for no store |
| a relative POSTMASTER_CONFIG is read from the caller's directory | a relative POSTMASTER_CONFIG is read from the caller's directory |
| with HOME unset, discover-project.sh still reports, with the kind left to ask | with HOME unset, discover-project.sh still reports, with the kind left to ask |
| discover-project.sh run by a relative path with CDPATH exported still finds the rule | discover-project.sh run by a relative path with CDPATH exported still finds the rule |
| a github target with no origin remote is pointed at store init, and one with a remote is not | a github target with no origin remote is pointed at store init, and one with a remote is not |
| ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside | ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside |
| without a store it goes to the github adapter, and the gh on PATH saw the call | without a store it goes to the github adapter, and the gh on PATH saw the call |
| [dynamic label] | [dynamic label] |

## log-action.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/log-action.ts` |

## plane.sh

| BASE control | TypeScript port |
|---|---|
|  if good else  |  if good else  |

## review-round.sh

| BASE control | TypeScript port |
|---|---|
| $STATE | $STATE |
| $STATE | $STATE |
| $1 | $1 |
| start clears the round's markers and fixes its limit from run.json | start clears the round's markers and fixes its limit from run.json |
| at the deadline, wait exits 3 and names the reviewer with no marker | at the deadline, wait exits 3 and names the reviewer with no marker |
| run-log.md records it as <lane> <lens>: DEGRADED, timeout | run-log.md records it as <lane> <lens>: DEGRADED, timeout |
| a degrade line records it, with the lens, the round and the cause | a degrade line records it, with the lens, the round and the cause |
| host.sh stop ends it, and its child in a session of its own | host.sh stop ends it, and its child in a session of its own |
| teardown takes the reviewers the wait recorded, and removes each scratch | teardown takes the reviewers the wait recorded, and removes each scratch |
| a wait run again keeps the round's deadline rather than starting a new one | a wait run again keeps the round's deadline rather than starting a new one |
| when every marker is in, wait exits 0 and records nothing | when every marker is in, wait exits 0 and records nothing |
| teardown stops what a finished reviewer's launch left running, and says so | teardown stops what a finished reviewer's launch left running, and says so |
| a scratch a reviewer switched onto a branch is still removed, and the branch kept | a scratch a reviewer switched onto a branch is still removed, and the branch kept |
| a reviewer that reported is neither recorded nor stopped | a reviewer that reported is neither recorded nor stopped |
| a wait from an earlier start of the round stands down, and records and stops nothing | a wait from an earlier start of the round stands down, and records and stops nothing |
| teardown from inside a scratch leaves it in place, and stops nothing | teardown from inside a scratch leaves it in place, and stops nothing |
| from outside, teardown stops the unfinished reviewer first, says so, then removes it | from outside, teardown stops the unfinished reviewer first, says so, then removes it |
| teardown given its reviewers needs no start, as at the cut, and records none for the round | teardown given its reviewers needs no start, as at the cut, and records none for the round |
| a directory that is no scratch is left in place | a directory that is no scratch is left in place |
| a worktree on the run's own branch is never detached or removed | a worktree on the run's own branch is never detached or removed |
| a marker another reviewer landed never stands in for a missing one | a marker another reviewer landed never stands in for a missing one |
| a round started before the machine restarted is not waited on | a round started before the machine restarted is not waited on |
| a round that was never started is not waited on | a round that was never started is not waited on |
| a limit of $v is not used: the default, and the warning says why | a limit of $v is not used: the default, and the warning says why |
| no run.json gets the default, and says so | no run.json gets the default, and says so |
| a timeout whose degrade line cannot be written exits 4, and says what was not recorded | a timeout whose degrade line cannot be written exits 4, and says what was not recorded |
| refused: review-round.sh ${args//$tmp/<tmp>} | refused: review-round.sh ${args//$tmp/<tmp>} |
| reviewers on several lines, one given twice, are each waited on once | reviewers on several lines, one given twice, are each waited on once |
| [dynamic label] | [dynamic label] |

## reviewers.sh

| BASE control | TypeScript port |
|---|---|
| $label | $label |
| the waybill lines name the reviewers, then each lens with its own lanes | the waybill lines name the reviewers, then each lens with its own lanes |
| a lens with its own line gets exactly those lanes | a lens with its own line gets exactly those lanes |
| a lens without one gets the reviewer list | a lens without one gets the reviewer list |
| and so does style | and so does style |
| a config without the table gives the reviewers line alone, as before | a config without the table gives the reviewers line alone, as before |
| reviewers default to the workhorses | reviewers default to the workhorses |
| the lenses are the review stage's, in order | the lenses are the review stage's, in order |
| a lens the review stage does not have is refused | a lens the review stage does not have is refused |
| and named | and named |
| a lane the config does not define is refused | a lane the config does not define is refused |
| and named | and named |
| a lens with no lanes is refused | a lens with no lanes is refused |
| a reviewer that is not a lane is refused | a reviewer that is not a lane is refused |
| no config is refused | no config is refused |
| a waybill lens that is not a lens is refused | a waybill lens that is not a lens is refused |
| a Team section with no reviewers line is refused, never read as no reviewers | a Team section with no reviewers line is refused, never read as no reviewers |
| reviewer lines in the ticket's text are not read | reviewer lines in the ticket's text are not read |
| no such waybill is refused | no such waybill is refused |
| [dynamic label] | [dynamic label] |

## run-log.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/run-log.ts` |

## run-meta.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/run-meta.ts` |

## run-times.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/run-times.ts` |

## runs-status.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/runs-status.ts` |

## setup.sh

| BASE control | TypeScript port |
|---|---|
| a lens given its own lanes is written to [team.lens_reviewers] | a lens given its own lanes is written to [team.lens_reviewers] |
| the written config resolves: the reviewers default to the workhorses, and security has its own | the written config resolves: the reviewers default to the workhorses, and security has its own |
| without lens answers there is no table, as before | without lens answers there is no table, as before |
| the coachman, the fallback and the postmaster each get their env file, with or without an effort | the coachman, the fallback and the postmaster each get their env file, with or without an effort |
| a role with no env file answer gets no env_file key | a role with no env file answer gets no env_file key |
| a review round's time limit defaults to 2400 seconds, under [review] | a review round's time limit defaults to 2400 seconds, under [review] |
| an answer sets it, up to 86400 | an answer sets it, up to 86400 |
| a round time limit of '$v' is refused, and nothing is written | a round time limit of '$v' is refused, and nothing is written |
| a lens reviewer that is not a lane is refused, and nothing is written | a lens reviewer that is not a lane is refused, and nothing is written |
| a coachman on a lane's model is refused | a coachman on a lane's model is refused |
| a missing answer is refused, naming it | a missing answer is refused, naming it |
| [dynamic label] | [dynamic label] |

## skill-refs.sh

| BASE control | TypeScript port |
|---|---|
| $@ | $@ |
| three bare references are three faults | three bare references are three faults |
| $tmp/bare.md | $tmp/bare.md |
| $tmp/bare.md | $tmp/bare.md |
| a fault names its file and line, and exits 1 | a fault names its file and line, and exits 1 |
| a path that reaches scripts/ another way is a fault | a path that reaches scripts/ another way is a fault |
| a script the repo does not have is a fault | a script the repo does not have is a fault |
| $tmp/good.md | $tmp/good.md |
| references through <tool>, and other directories' scripts/, read zero | references through <tool>, and other directories' scripts/, read zero |
| $tmp/good.md | $tmp/good.md |
| $tmp/nowhere.md | $tmp/nowhere.md |
| a file that cannot be read is exit 2, not a clean result | a file that cannot be read is exit 2, not a clean result |
| every bare reference is fixed, none is doubled, and the one it cannot fix is still named | every bare reference is fixed, none is doubled, and the one it cannot fix is still named |
| a second --fix changes nothing | a second --fix changes nothing |
| --fix leaves a file with no bare reference alone | --fix leaves a file with no bare reference alone |
| [dynamic label] | [dynamic label] |

## stage.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/stage.ts` |

## style-findings.sh

| BASE control | TypeScript port |
|---|---|
|  if shape(line.strip()) else  |  if shape(line.strip()) else  |
| $1 | $1 |
| $1 | $1 |
| log-action.sh refuses a finding with no class, and writes nothing | log-action.sh refuses a finding with no class, and writes nothing |
| $t | $t |
| nothing the gate runs was run | nothing the gate runs was run |
| $d | $d |
| $five | $five |
| $five | $five |
| $m | $m |
| $via | $via |
| $none | $none |
| $zero | $zero |
| $zero | $zero |
| $now | $now |
| $via | $via |
| $via | $via |
| $five | $five |
| $five | $five |
| $none | $none |
| $tmp/nowhere | $tmp/nowhere |
| the runbooks name list, count, gate and check, and no other subcommand | the runbooks name list, count, gate and check, and no other subcommand |
| and a subcommand the script lacks would be caught | and a subcommand the script lacks would be caught |
| every form coachman.md gives is a sort line | every form coachman.md gives is a sort line |
| coachman.md says: $want | coachman.md says: $want |
| postmaster.md says: $want | postmaster.md says: $want |
| and the style sort is no escalation | and the style sort is no escalation |
| and the rule's old wording would be caught | and the rule's old wording would be caught |
| at a terminal it removes a file git made read-only, and asks nothing | at a terminal it removes a file git made read-only, and asks nothing |
| one that reads the terminal would ask instead, and remove nothing | one that reads the terminal would ask instead, and remove nothing |
| [dynamic label] | [dynamic label] |

## ticket-check.sh

| BASE control | TypeScript port |
|---|---|
| $label | $label |
| $1 | $1 |
| a well-formed ticket passes | a well-formed ticket passes |
| it counts three criteria, not the nested number or the lines under them, then prints the turnpikes | it counts three criteria, not the nested number or the lines under them, then prints the turnpikes |
| Notes and User journey are optional | Notes and User journey are optional |
| without --title only the body is judged | without --title only the body is judged |
| headings match ignoring case, a colon, the slash's spacing and a closing # | headings match ignoring case, a colon, the slash's spacing and a closing # |
| a criterion's text may start on the line below its number | a criterion's text may start on the line below its number |
| a list indented three spaces, and a thematic break after it | a list indented three spaces, and a thematic break after it |
| a question mark in quotes or inside a word is not a question | a question mark in quotes or inside a word is not a question |
| a code span that wraps onto the next line is still code | a code span that wraps onto the next line is still code |
| a comment marker inside code hides nothing | a comment marker inside code hides nothing |
| a <!-- inside a line that the line does not close is text | a <!-- inside a line that the line does not close is text |
| a <!-- at the start of a line that nothing closes is text | a <!-- at the start of a line that nothing closes is text |
| a comment inside a line is not read | a comment inside a line is not read |
| a criterion that opens with a fenced block | a criterion that opens with a fenced block |
| a line opening with a three-backtick code span is not a fence | a line opening with a three-backtick code span is not a fence |
| TODO as a word is not a mark | TODO as a word is not a mark |
| a body with CRLF line endings passes | a body with CRLF line endings passes |
| a byte-order mark hides no heading | a byte-order mark hides no heading |
| a body read from standard input | a body read from standard input |
| a ticket read through the adapter passes, its log included | a ticket read through the adapter passes, its log included |
| no title | no title |
| no title in the adapter's read | no title in the adapter's read |
| no problem or feature | no problem or feature |
| an empty problem or feature | an empty problem or feature |
| no acceptance criteria | no acceptance criteria |
| criteria that are not numbered | criteria that are not numbered |
| criteria numbered out of order | criteria numbered out of order |
| a criterion that asks a question | a criterion that asks a question |
| a question closed by emphasis | a question closed by emphasis |
| a question closed by a bracket | a question closed by a bracket |
| a full-width question mark | a full-width question mark |
| the fault quotes the sentence that asks | the fault quotes the sentence that asks |
| a criterion marked TBD | a criterion marked TBD |
| a criterion marked TODO: | a criterion marked TODO: |
| comment markers in code hide no criterion | comment markers in code hide no criterion |
| an empty criterion | an empty criterion |
| a criterion outside the numbered list | a criterion outside the numbered list |
| a paragraph outside the list is named once, not per line | a paragraph outside the list is named once, not per line |
| an unnumbered criterion straight after a numbered one | an unnumbered criterion straight after a numbered one |
| a heading straight after a criterion | a heading straight after a criterion |
| text after a stray block is not credited to the criterion above | text after a stray block is not credited to the criterion above |
| acceptance criteria twice | acceptance criteria twice |
| no direction, even with one inside a fenced block | no direction, even with one inside a fenced block |
| a direction marked TBD | a direction marked TBD |
| a direction that says only TODO | a direction that says only TODO |
| a direction written only in a comment is empty | a direction written only in a comment is empty |
| a comment that starts a line hides everything up to the next --> | a comment that starts a line hides everything up to the next --> |
| a direction at the wrong level | a direction at the wrong level |
| a direction before the criteria | a direction before the criteria |
| no turnpikes | no turnpikes |
| a ### Turnpikes in the notes, with no ## Turnpikes, is named at the wrong level | a ### Turnpikes in the notes, with no ## Turnpikes, is named at the wrong level |
| a list item that opens a fence is code, and names no turnpike | a list item that opens a fence is code, and names no turnpike |
| a turnpike scripts/turnpikes.sh does not list is named | a turnpike scripts/turnpikes.sh does not list is named |
| none listed with another turnpike | none listed with another turnpike |
| an empty turnpikes section | an empty turnpikes section |
| turnpikes marked TBD | turnpikes marked TBD |
| turnpikes at the wrong level | turnpikes at the wrong level |
| turnpikes before the direction | turnpikes before the direction |
| turnpikes twice | turnpikes twice |
| an empty ticket names all five parts | an empty ticket names all five parts |
| this check names a turnpike that turnpikes.sh does not list | this check names a turnpike that turnpikes.sh does not list |
| no arguments is a usage error | no arguments is a usage error |
| a missing body file is refused | a missing body file is refused |
| a tracker kind with no adapter script is refused, not judged | a tracker kind with no adapter script is refused, not judged |
| a config that does not parse is named as one | a config that does not parse is named as one |
| an adapter that cannot read the ticket is exit 1, not a shape fault | an adapter that cannot read the ticket is exit 1, not a shape fault |
| with no turnpikes.sh beside it, the check gives no verdict | with no turnpikes.sh beside it, the check gives no verdict |
| a turnpikes.sh whose table breaks its rules gives no verdict | a turnpikes.sh whose table breaks its rules gives no verdict |
| a turnpikes.sh that fails with nothing to say gives no verdict, never a pass | a turnpikes.sh that fails with nothing to say gives no verdict, never a pass |
| $1 | $1 |
| the spliced body passes the check | the spliced body passes the check |
| blank lines at the end of the body are kept, byte for byte | blank lines at the end of the body are kept, byte for byte |
| text before the first heading of the sections | text before the first heading of the sections |
| a section that is not at level two | a section that is not at level two |
| the same section twice | the same section twice |
| a ### Turnpikes in the notes is neither deleted nor left beside a new one | a ### Turnpikes in the notes is neither deleted nor left beside a new one |
| a stale ### Direction in the notes is not left beside the new one | a stale ### Direction in the notes is not left beside the new one |
| a repo with a store is read through local.sh, though the config names github | a repo with a store is read through local.sh, though the config names github |
| a repo with no store is read through the kind the config names | a repo with no store is read through the kind the config names |
| a store that cannot be looked for stops the check, and no adapter is read | a store that cannot be looked for stops the check, and no adapter is read |
| [dynamic label] | [dynamic label] |

## tool-faults.sh

| BASE control | TypeScript port |
|---|---|
| seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart | seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart |
| a line that is not JSON is left out, and said so; one with a raw line separator is read | a line that is not JSON is left out, and said so; one with a raw line separator is read |
| the harvest logs what it found | the harvest logs what it found |
| a fault no ticket holds is new, and its line names its draft | a fault no ticket holds is new, and its line names its draft |
| only an escalate naming the fault's file counts as its escalation | only an escalate naming the fault's file counts as its escalation |
| each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh | each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh |
| a draft names the run by its public id, and the postmaster it ran | a draft names the run by its public id, and the postmaster it ran |
| postmaster's own files and words are kept, and what is withheld is marked | postmaster's own files and words are kept, and what is withheld is marked |
| a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked | a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked |
| comment says once, on the ticket that holds it, that it was seen again, and logs it | comment says once, on the ticket that holds it, that it was seen again, and logs it |
| on the user's word that a ticket holds a new fault, comment names it there | on the user's word that a ticket holds a new fault, comment names it there |
| file files the draft as it is, once, and logs the new ticket | file files the draft as it is, once, and logs the new ticket |
| decline records the user's no, and files nothing | decline records the user's no, and files nothing |
| a later harvest reads what was done from the run's log, not its state file | a later harvest reads what was done from the run's log, not its state file |
| in a later run, a fault a comment names on any ticket is known there | in a later run, a fault a comment names on any ticket is known there |
| a comment on a closed ticket says it is closed | a comment on a closed ticket says it is closed |
| the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known | the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known |
| a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase | a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase |
| a changed draft is filed when it is still safe, in a project named with words postmaster uses | a changed draft is filed when it is still safe, in a project named with words postmaster uses |
| a title is cut between words, so a changed draft keeps its paths whole | a title is cut between words, so a changed draft keeps its paths whole |
| a fault keeps the kind of control its line recorded; with none recorded, the list's | a fault keeps the kind of control its line recorded; with none recorded, the list's |
| a fault with a 100,000-character token is harvested in seconds | a fault with a 100,000-character token is harvested in seconds |
| a fault the log no longer gives is refused by name | a fault the log no longer gives is refused by name |
| a ticket created but not put on the board is still filed, and logged | a ticket created but not put on the board is still filed, and logged |
| the leak check finds a planted piece | the leak check finds a planted piece |
| no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment | no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment |
| a second comment or file says it is done, and writes nothing | a second comment or file says it is done, and writes nothing |
| a clean log yields no fault and no draft | a clean log yields no fault and no draft |
| a run still open is not harvested | a run still open is not harvested |
| a repository the user does not own is no tracker: the faults are kept | a repository the user does not own is no tracker: the faults are kept |
| and nothing is filed there | and nothing is filed there |
| a copy of postmaster inside the target is no tracker, and withholds the target all the same | a copy of postmaster inside the target is no tracker, and withholds the target all the same |
| a tracker that cannot be searched leaves the fault unchecked, and nothing is filed | a tracker that cannot be searched leaves the fault unchecked, and nothing is filed |
| file refuses a draft changed to carry the target's code | file refuses a draft changed to carry the target's code |
| [dynamic label] | [dynamic label] |

## turnpikes.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| $1 | $1 |
| --list names style, bug and security, once each | --list names style, bug and security, once each |
| the default set is style, bug and security | the default set is style, bug and security |
| the three run in the review leg | the three run in the review leg |
| turnpikes:  style, bug,  security | turnpikes:  style, bug,  security |
| turnpikes: bug, security | turnpikes: bug, security |
| after synthesis the poll says DISPATCH | after synthesis the poll says DISPATCH |
| the leg after synthesis is ship | the leg after synthesis is ship |
| the ship leg starts from synthesis's hand-off, which passes its check | the ship leg starts from synthesis's hand-off, which passes its check |
| after ship the poll says DISPATCH, and no leg follows: Stage G | after ship the poll says DISPATCH, and no leg follows: Stage G |
| it closes with no review stage | it closes with no review stage |
| [dynamic label] | [dynamic label] |

## verify.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| the suite's command is the project's own script | the suite's command is the project's own script |
| the gate is the one it was given | the gate is the one it was given |
| and a playwright config's is playwright's | and a playwright config's is playwright's |
| a web app with no suite has a browser check with no command | a web app with no suite has a browser check with no command |
| a declared gate wins over the one discovery gave | a declared gate wins over the one discovery gave |
| a scored check says what passes | a scored check says what passes |
| a check that uses a default keeps its timeout | a check that uses a default keeps its timeout |
| record says when the project's declared gate overrides the one it was given | record says when the project's declared gate overrides the one it was given |
| a check that uses a default runs its script and says what it shows | a check that uses a default runs its script and says what it shows |
| a committed declaration raises no warning | a committed declaration raises no warning |
| an uncommitted declaration is warned of | an uncommitted declaration is warned of |
| $1 | $1 |
| record writes checks.json and prints the checks | record writes checks.json and prints the checks |
| a second record leaves checks.json alone | a second record leaves checks.json alone |
| arm copies the checks into the worktree | arm copies the checks into the worktree |
| and the ticket, without the rest of the waybill | and the ticket, without the rest of the waybill |
| and git does not see what it wrote | and git does not see what it wrote |
| $1 | $1 |
| a run with a failed check exits 2 | a run with a failed check exits 2 |
| colour codes are taken out of the reasons | colour codes are taken out of the reasons |
| a workhorse's run logs nothing to the run | a workhorse's run logs nothing to the run |
| and logs one verify line per check | and logs one verify line per check |
| every line it logs parses, colour codes and all | every line it logs parses, colour codes and all |
| and leaves the workhorse's own copy as the workhorse left it | and leaves the workhorse's own copy as the workhorse left it |
| each naming the branch, the commit and the result | each naming the branch, the commit and the result |
| with its output kept in the run | with its output kept in the run |
| the coachman's journey report goes in the run | the coachman's journey report goes in the run |
| a workhorse's in its worktree | a workhorse's in its worktree |
| results give each check's latest result at HEAD | results give each check's latest result at HEAD |
| a log line that does not parse stops results rather than being skipped | a log line that does not parse stops results rather than being skipped |
| a summary that pastes the run's lines holds, signals, backticks and several lines included | a summary that pastes the run's lines holds, signals, backticks and several lines included |
| a summary missing a check is unverified | a summary missing a check is unverified |
| a claim the coachman's run contradicts is named | a claim the coachman's run contradicts is named |
| a check run with another command is unverified | a check run with another command is unverified |
| a later commit has no results until the checks run on it | a later commit has no results until the checks run on it |
| a gate and a suite that pass, pass, and a journey the ticket lacks is not run | a gate and a suite that pass, pass, and a journey the ticket lacks is not run |
| a gate and a suite that fail, fail | a gate and a suite that fail, fail |
| a run whose every check passed exits 0 | a run whose every check passed exits 0 |
| a run with a check not run and none failed exits 3 | a run with a check not run and none failed exits 3 |
| a worktree nobody armed is refused | a worktree nobody armed is refused |
| a run that recorded no checks cannot arm a worktree | a run that recorded no checks cannot arm a worktree |
| a new file the commit lacks is refused, and named | a new file the commit lacks is refused, and named |
| so is a changed file, in a workhorse's run too | so is a changed file, in a workhorse's run too |
| a check that rewrites a tracked file fails, and names it | a check that rewrites a tracked file fails, and names it |
| and the checks after it do not run | and the checks after it do not run |
| and nothing is logged as passed | and nothing is logged as passed |
| so does a check that leaves a new file git sees | so does a check that leaves a new file git sees |
| the runner waits without os.waitid, which python lacks on macOS before 3.13 | the runner waits without os.waitid, which python lacks on macOS before 3.13 |
| modules in the target's own directory are never imported | modules in the target's own directory are never imported |
| a process a check leaves running is stopped when it ends | a process a check leaves running is stopped when it ends |
| a run that is stopped stops its check | a run that is stopped stops its check |
| a default whose script cannot be started is not run | a default whose script cannot be started is not run |
| discover-project.sh names the declared gate | discover-project.sh names the declared gate |
| and each check, where it came from and what it shows | and each check, where it came from and what it shows |
| a default says which one it is | a default says which one it is |
| a gate of several lines is carried as one line that fails as the gate does | a gate of several lines is carried as one line that fails as the gate does |
| a broken declaration is warned of, and no check is guessed | a broken declaration is warned of, and no check is guessed |
| [dynamic label] | [dynamic label] |

## verify-examples.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| matching transcripts pass, exits and state within a block included | matching transcripts pass, exits and state within a block included |
| only a waybill's ticket part is read | only a waybill's ticket part is read |
| a build script runs before the bin is looked for | a build script runs before the bin is looked for |
| a different output fails and shows both | a different output fails and shows both |
| a different exit fails and names both | a different exit fails and names both |
| a failed build fails | a failed build fails |
| a transcript outside the User journey is no example | a transcript outside the User journey is no example |
| a ticket with no User journey is not run | a ticket with no User journey is not run |
| a bin named with a path is not run | a bin named with a path is not run |
| and nothing is written where it points | and nothing is written where it points |
| a bin whose interpreter is not installed is not run | a bin whose interpreter is not installed is not run |
| a build whose package manager is not installed is not run | a build whose package manager is not installed is not run |
| a project with no bin is not run | a project with no bin is not run |
| a bin with no #! line is not run | a bin with no #! line is not run |
| a missing ticket is not run | a missing ticket is not run |
| a project with no package.json is not run | a project with no package.json is not run |
| [dynamic label] | [dynamic label] |

## verify-journey.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| a complete report passes | a complete report passes |
| case, spacing, a closing stop and steps of its own do not matter | case, spacing, a closing stop and steps of its own do not matter |
| a list's items are its steps, continuation lines included | a list's items are its steps, continuation lines included |
| the report's path names the commit | the report's path names the commit |
| the report for HEAD is found through the armed checks | the report for HEAD is found through the armed checks |
| and passes once its screenshots are beside it | and passes once its screenshots are beside it |
| the format says how a step is marked | the format says how a step is marked |
| a step marked did not fails, and says what happened | a step marked did not fails, and says what happened |
| a step not in the report is not run | a step not in the report is not run |
| steps out of order are not run | steps out of order are not run |
| a missing screenshot is not run | a missing screenshot is not run |
| an empty screenshot is not run | an empty screenshot is not run |
| a screenshot outside the report's directory is not run | a screenshot outside the report's directory is not run |
| a step with no verdict is not run | a step with no verdict is not run |
| no report is not run | no report is not run |
| a ticket with no User journey is not run | a ticket with no User journey is not run |
| a User journey with no steps is not run | a User journey with no steps is not run |
| a walk of an earlier commit does not count for a later one | a walk of an earlier commit does not count for a later one |
| [dynamic label] | [dynamic label] |

## verify-library.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| only the tests that import it by name and open a line with a test are chosen, not helpers, fixtures, method calls or comments | only the tests that import it by name and open a line with a test are chosen, not helpers, fixtures, method calls or comments |
| those tests pass through the package's exports | those tests pass through the package's exports |
| a build script runs first | a build script runs first |
| and it did run | and it did run |
| a library that breaks its interface fails | a library that breaks its interface fails |
| a failed build fails | a failed build fails |
| a library tested only by path is not run | a library tested only by path is not run |
| a package with no name is not run | a package with no name is not run |
| a project with no package.json is not run | a project with no package.json is not run |
| a runner the project names but has not installed is not run | a runner the project names but has not installed is not run |
| a library whose only by-name import is in a helper is not run | a library whose only by-name import is in a helper is not run |
| tests with no node to run them are not run | tests with no node to run them are not run |
| [dynamic label] | [dynamic label] |

## view-stream.sh

| BASE control | TypeScript port |
|---|---|
| $1 | $1 |
| $1 | $1 |
| mimo: a session is named once, and only its last step says done | mimo: a session is named once, and only its last step says done |
| fifty unknown events of one type show as one line | fifty unknown events of one type show as one line |
| a whole stream renders with no raw JSON in it | a whole stream renders with no raw JSON in it |
| every line is shown, with its time, and the unterminated last line too | every line is shown, with its time, and the unterminated last line too |
| --from skips what was there before | --from skips what was there before |
| [dynamic label] | [dynamic label] |

## wait-for-markers.sh

| BASE control | TypeScript port |
|---|---|
| (review self-test source for assertions) | `scripts/wait-for-markers.ts` |

## wiki-lint.sh

| BASE control | TypeScript port |
|---|---|
| [dynamic label] | [dynamic label] |
