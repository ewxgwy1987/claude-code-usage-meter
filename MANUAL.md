# usage-meter user manual

This manual covers everyday use. The [README](README.md) is the full reference, including
how the mod works inside.

## 1. Get started

1. **Install** the mod as the [README](README.md#install) describes. The quickest way is
   `claude --plugin-dir /path/to/claude-code-usage-meter`.
2. **Start a session** and send any message.
3. **Look above the prompt.** The band appears after Claude's first reply.
4. **Type `/usage-meter`** any time for the same figures as text, plus averages over your
   recent tasks.

## 2. Where it appears

| | Terminal | Desktop app | Phone (Remote Control) |
|---|---|---|---|
| Band above the prompt | Yes | Yes | No |
| `/usage-meter` report | Yes | Yes | As text, where commands run (not tested there) |
| Bars | Block characters `███░░` | Graphic bars | Not shown |

Claude Code draws the band above the prompt only in the terminal and the desktop app. In
VS Code and the mobile app, use `/usage-meter` where that surface runs commands.

## 3. The command

| Command | What it does |
|---|---|
| `/usage-meter` | Re-reads the figures and prints a text report. It works even while Claude is busy. |

The report shows plan usage with its age, one line per rate-limit window, session cost,
context fill, the running or last task, and the average task over the last 20.

## 4. Settings

There are none. The mod has no options.

## 5. Reading the band

```
5h       ████████░░░░░░░░░░░░  42% 58% left · resets in 2h 13m · as of 14:05:31 (CLI)
7d       █░░░░░░░░░░░░░░░░░░░   5% 95% left · resets in 4d 6h
Context  ████░░░░░░░░░░░░░░░░  21% 42K / 200K · this window
Session $0.150 · Last task: 1.5K tok (out 500, 3 req) · $0.050 · 5h +2.0% · ~29 more such tasks fit in the 5h window
```

| Row | Meaning |
|---|---|
| `5h`, `7d` | How much of your plan's 5-hour and 7-day limits is used, and when each resets. Other limits your plan reports, such as `7d Opus`, appear too. |
| `Plan` | Shown instead of the limit rows when no limits have been reported yet. |
| `Context` | How full this session's context window is. |
| `Task` | While a task runs: its tokens so far against your average task. 100% means "as big as an average task". |
| Footer | Session cost, then the last task's tokens, cost and share of the 5-hour window. |

**"as of HH:MM:SS (source)"** on the first row says when and where the figures were read.
The source is `CLI` for a terminal session and `app` for the desktop app. Figures arrive
with Claude's replies, so they age while Claude is idle.

**"~N more such tasks fit"** is a rough guide: the 5-hour room left divided by your
average task's share of it.

### Colours

| Bar | Green / cyan | Yellow | Red |
|---|---|---|---|
| Rate limits and context | below 70% (green) | 70% to under 90% | 90% and above |
| Task (vs. average) | below 80% (cyan) | 80% to 100% | above 100% |

## 6. Using several windows

Plan limits are shared by every window on your plan, so the mod shares its figures too.
The newest rate-limit reading is saved where every Claude Code process on the machine
that uses the same configuration folder can see it.

- A reply in the desktop app updates the bars in an idle terminal session, and the other
  way round. The `(source)` label tells you which window took the reading.
- Usage from other computers, or from claude.ai, shows up only after the next reply on
  this computer.
- Context, cost and task figures are per window. They are not shared.
- Task averages start over in each new session.

## 7. Cost in tokens

| Action | Model calls |
|---|---|
| Drawing the band | None |
| The 60-second refresh timer | None |
| `/usage-meter` | None |

usage-meter never calls a model. It only reads figures Claude Code already has.

## 8. Troubleshooting

| Symptom | What to do |
|---|---|
| Nothing appears at all | Run `claude plugin validate /path/to/claude-code-usage-meter`. For `CLAUDE_CODE_PLUGIN_DIRS`, use an absolute path, put it in **user** settings, and start a new session. |
| `Plan no rate limits reported` | No reply yet in any window on this computer, or you use API-key billing (no plan limits are sent then). Send a message. |
| No `Context` row | It appears after the first reply in this window. |
| `Task: no task yet` | No task has finished in this session. Estimates start after the first one. |
| Figures look old | They only refresh with model replies. Any reply on this computer updates them. Check the `as of` time. |
| No band in the mobile app or VS Code | Expected. Use `/usage-meter`. |
| Band hidden for a moment | A survey is using the space. It comes back when the survey closes. You can also collapse or expand it yourself (ctrl+x ctrl+a, or the `[-]` mark). |
| The mod appears twice | Two paths load it, for example an old copy plus `CLAUDE_CODE_PLUGIN_DIRS`. Keep one. |
| A prepaid credit balance is missing | Claude Code does not receive it. Check your Console billing page. |

## See also

Two sibling mods, [progress-board](https://github.com/ewxgwy1987/claude-code-progress-board)
and [session-toc](https://github.com/ewxgwy1987/claude-code-session-toc), and the
[collection](https://github.com/ewxgwy1987/claude-code-mods) for installing all three.
