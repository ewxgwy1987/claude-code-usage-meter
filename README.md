# usage-meter

A Claude Code mod that shows how much of your plan you have used, right above the prompt.
It draws coloured bars for your plan's rate limits (the 5-hour and 7-day windows), the
context-window fill and the running task. A footer line shows the session cost and the
last task's token count. The `/usage-meter` command prints the same figures as text, plus
averages over your recent tasks. It never calls a model, so watching your usage costs no
tokens.

For everyday use, see the [user manual](MANUAL.md). This README is the full reference.

What the band above the prompt looks like (colours not shown):

```
5h       ████████░░░░░░░░░░░░  42% 58% left · resets in 2h 13m · as of 14:05:31 (CLI)
7d       █░░░░░░░░░░░░░░░░░░░   5% 95% left · resets in 4d 6h
Context  ████░░░░░░░░░░░░░░░░  21% 42K / 200K · this window
Session $0.150 · Last task: 1.5K tok (out 500, 3 req) · $0.050 · 5h +2.0% · ~29 more such tasks fit in the 5h window
```

While a task is running, and at least one earlier task in this session has finished,
a `Task` bar appears and the footer shrinks to the session cost:

```
Task     ███████░░░░░░░░░░░░░  35% 520 / ~1.5K tok est. (avg of 1)
Session $0.120
```

## Requirements

- A Claude Code build that supports function-hook plugins (mods). Version 2.1.289 or
  later was used to build and test it.
- A Claude subscription plan, if you want the rate-limit bars. With API-key billing,
  Claude Code receives no plan limits, so the mod shows only context, cost and task figures.

## Install

The repository root is the plugin. Clone it first:

```sh
git clone https://github.com/ewxgwy1987/claude-code-usage-meter.git
```

Then pick one way of loading it.

**A. One session.**

```sh
claude --plugin-dir /path/to/claude-code-usage-meter
```

**B. Every session**, including the desktop app and Remote Control sessions started on
that machine. Add this to your **user** settings, `~/.claude/settings.json`. Project
settings are ignored for this setting.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-code-usage-meter"
  }
}
```

- The path must be absolute; `~` is allowed.
- On Windows forward slashes work, for example `C:/src/claude-code-usage-meter`.
- Separate several paths with `;` on Windows and `:` elsewhere.
- You can instead name a folder that holds several mod clones side by side. That loads
  each one.
- Start a new session afterwards.

**C. Plugin marketplace.** The repository is also a marketplace:

```
/plugin marketplace add ewxgwy1987/claude-code-usage-meter
/plugin install usage-meter@claude-code-usage-meter
```

To check that it loaded, start a session and send a message. The band appears above the
prompt after the first reply, and `/usage-meter` shows up in the command menu.

## Usage

### The `/usage-meter` command

| Command | Arguments | What it does |
|---|---|---|
| `/usage-meter` | none | Re-reads the figures and prints a text report. |

The command runs at once, even while a turn is in progress. You don't have to wait for
the turn to finish. The report contains:

- **Plan usage**, with where and when the figures came from, and how old they are
  (`just now`, or for example `3m ago`).
- One line per rate-limit window: a 20-cell bar, percent used, percent left and the time
  until it resets.
- **Session cost** and **context fill** for this window.
- **The task line**: the running task, or the last finished one (see below).
- **Average task (last N)**: the mean tokens, cost and share of the 5-hour window per task.
- A note that other windows on this computer share plan limits (see "How it works").

If no plan limits have been reported, the report says so. This happens with API-key
billing, or before the first model reply. A prepaid credit balance is not available to
Claude Code. Check your Console billing page for it.

### Reading the band

| Row | Meaning |
|---|---|
| `5h`, `7d` | Plan rate-limit windows. Other windows the plan reports appear too: `7d Opus`, `7d Sonnet`, `Spend` (a gateway's spend limit), or the raw name. The first row also says `as of HH:MM:SS (source)`. |
| `Plan` | Shown instead of the limit rows when no limits are reported. |
| `Context` | How full this session's context window is, as tokens used / window size. It appears once a response has reported the fill. |
| `Task` | Tokens used by the running task, compared with your average task. 100% means "as big as an average task". Shown only while a task runs and an average exists. |
| Footer | Session cost (`Session cost n/a` if unknown) and the task line. |

The source label in `as of ... (source)` is `CLI` for a terminal session and `app` for a
desktop-app session. Other surfaces show their own name (for example `mobile`, `vscode`),
and a session with no surface shows `headless`.

The task line has two forms:

- `Task running: <tokens> tok (out <output>, <n> req) · $<cost> · est. total ~<tokens> / $<cost> (avg of N)`
- `Last task: <tokens> tok (out <output>, <n> req) · $<cost> · 5h +<x>% · ~<n> more such tasks fit in the 5h window`

Before the first task you see `Task: no task yet; estimates appear after the first one`.

### Colour thresholds

| Bar | Green / cyan | Yellow | Red |
|---|---|---|---|
| Rate limits and context | below 70% (green) | 70% to under 90% | 90% and above |
| Task (vs. average) | below 80% (cyan) | 80% to 100% | above 100% |

Bars are clamped to 0-100%, so a spend limit past 100% shows a full bar. The bar width
follows the band's width, from 10 to 30 cells. If the band has fewer rows than the mod
draws, the extra rows are cut.

### Settings

There are none. The mod has no `userConfig` in its `plugin.json`, and no options.

### Where it shows

| Surface | Band above the prompt | `/usage-meter` |
|---|---|---|
| Terminal (CLI) | yes | yes |
| Claude Code desktop app | yes | yes |
| Mobile app, VS Code | no (Claude Code draws that band on terminal and desktop only) | as text, where that surface runs commands (not tested there) |

The band steps aside while a survey is using the same space.

## How it works

### Events it hooks

| Event | What the mod does |
|---|---|
| `session.start` | Registers `/usage-meter`, takes a first reading and starts a 60-second timer. |
| `session.measure` | Takes the figures Claude Code measures after responses. |
| `turn.start` | Starts a new task record, noting the cost and 5-hour usage at the start. |
| `turn.step` | After each model request, adds its tokens to the running task. |
| `turn.complete` | Closes the task (main conversation only), works out its cost and 5-hour share, and adds it to the history. |
| `command.run` | Prints the `/usage-meter` report. |
| `ui.render` (`AbovePrompt`) | Draws the band. |

### Where each number comes from

- **Rate limits, context and session cost** come from Claude Code's own session usage.
  These are the same figures the status line uses (`$.session.usage()` and the
  `session.measure` event). That call is free: it reads figures Claude Code already has.
- **Task tokens** are the sum of input, output, cache-read and cache-creation tokens from
  every model request in the turn. Subagent requests made during the turn count too.
  If no request was seen, the turn's own total is used.
- **Task cost** is the session cost at the end of the turn minus the cost at its start.
- **5h +x%** is the 5-hour figure at the end of the task minus the figure at its start.
  It is left out when the window reset during the task (the difference would be negative).
- **Averages** use the last 20 finished tasks that used tokens. Interrupted tasks are not
  counted. **"~N more such tasks fit"** is the 5-hour percentage left divided by the
  average 5-hour share per task, rounded down.

### What is stored, and where

| Data | Kept in | Lifetime |
|---|---|---|
| Latest snapshot, current task, task history, last readings | Session state held by Claude Code | This session. It survives a hot reload of the mod, but a new session starts empty. |
| Key `limits`: the newest rate-limit reading, with its time and source | The plugin store, a JSON file of the plugin's own in your Claude Code configuration directory | Between sessions. Every Claude Code process on the machine that uses that directory shares it. |

Each window publishes its own reading to `limits` only if it is newer than the stored one.
Each window shows whichever reading is newest, its own or the stored one. So a reply in
the desktop app updates the bars in an idle terminal session, and the other way round.
That is why the first row says where and when the figures came from.

### The timer, and why it costs no tokens

Every 60 seconds the mod re-reads the session usage and the stored `limits` key, then
redraws. It never sends a request to a model. The test suite checks that the timer runs
for more than 40 simulated minutes with no model call.

### Limits and accuracy

- Plan rate limits arrive only with model responses. Nothing asks the server for them.
  When every window is idle, the figures can be minutes or hours old. The `as of` time
  tells you how old.
- Usage from other computers, or from claude.ai, shows up only after the next model reply
  on this computer.
- A reading's time is when this window last saw the figures change. It is not refreshed
  when a reply reports the same figures.
- Task cost and the 5-hour share are differences of session-wide totals. Usage in other
  windows during the task is included in the 5-hour share.
- The averages start over in each new session.
- Percentages come from Claude Code as reported, with at most one decimal.

## Tokens and privacy

**Tokens.** usage-meter never calls a model. Not the timer, not the band, not the
`/usage-meter` command. It only reads figures Claude Code already has, so it adds
nothing to your usage.

**What is stored.** One key, `limits`, in Claude Code's plugin store on your machine. It
holds the newest rate-limit reading: the percentages, reset times, when the reading was
taken and the surface that took it (`CLI`, `app` and so on). Task history and the rest
live only in session state and are gone when the session ends. The mod sends nothing
anywhere.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No limit rows, `Plan no rate limits reported` | No model reply yet in any window on this computer, or API-key billing. Send a message and wait for a reply. |
| No `Context` row | No response has reported the context fill yet in this window. It appears after the first reply. |
| `Task: no task yet` | No task has finished in this session. The estimates start after the first one. |
| Figures look old | See "Limits and accuracy". Any model reply on this computer refreshes them. |
| No band in the mobile app or VS Code | Expected. Use `/usage-meter` where commands are available. |
| Nothing appears at all | Check that the mod loads: run `claude plugin validate /path/to/claude-code-usage-meter` and fix what it reports. Check that the path in `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` points to the clone (or to a folder holding it) and is absolute. Remember the setting belongs in user settings, not project settings. Start a new session after changing it. |
| The mod appears twice | Two paths load it, for example an old copy plus `CLAUDE_CODE_PLUGIN_DIRS`, or a clone plus a marketplace install. Keep one. |
| Band hidden for a moment | A survey is using the band. It comes back when the survey closes. You can also collapse or expand the band yourself (ctrl+x ctrl+a, or the `[-]` mark). |

## Development

Folder layout:

| Path | Contents |
|---|---|
| `.claude-plugin/plugin.json` | Name, version, description and the path to the mod's types. |
| `.claude-plugin/marketplace.json` | Makes the repository a marketplace with one plugin, `usage-meter`. |
| `hooks/hooks.json` | Lists the hook module, `register.tsx`. |
| `hooks/register.tsx` | All the logic and the band's drawing. |
| `types/index.d.ts` | The mod's data types and its declared session state. |
| `tests/usage-meter.test.ts` | Tests run by `claude plugin test`. |
| `tsconfig.json` | Extends `./.claude-plugin/types/tsconfig.json`. |

Commands, run from the repository root:

```sh
claude plugin validate .               # check the manifest, hooks and state names
claude plugin test .                   # run the tests
npx -p typescript tsc -p . --noEmit    # type-check
```

`tsconfig.json` extends `./.claude-plugin/types/tsconfig.json`. Claude Code writes that
file, along with the engine's type declarations, into `.claude-plugin/types/` when it
loads the plugin. So load the plugin once (for example with `--plugin-dir`) before you
type-check. That folder is in `.gitignore`.

While a session loads the clone through `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`,
saving a file reloads the mod straight away.

The tests cover these cases:

- A finished task is recorded, and the next task shows an estimate.
- An interrupted task is not counted.
- Bars fill in proportion and clamp at both ends.
- A newer reading from another window wins.
- An older local reading never overwrites a newer stored one.
- The timer shares new readings without calling a model.

## See also

- [claude-code-progress-board](https://github.com/ewxgwy1987/claude-code-progress-board): a pane with bars and time-left estimates for tasks, subagents and workflow runs.
- [claude-code-session-toc](https://github.com/ewxgwy1987/claude-code-session-toc): a pane with a table of contents of the whole session.
- [claude-code-mods](https://github.com/ewxgwy1987/claude-code-mods): the collection, a marketplace for installing all three.

## License

[MIT](LICENSE) © 2026 Rain Guo
