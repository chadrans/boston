# The Boston forecast

A one-page, running forecast of whether I move from Indianapolis to Boston. It's plain HTML with hand-drawn SVG: no libraries, no build step, no package installs.

Each update is three numbers: a floor, a most-likely estimate, and a ceiling. The page draws each one as a three-point (PERT) curve that peaks at the estimate and leans toward the side with more room.

```
site/index.html      page and styles
site/app.js          charts and interaction
site/data.json       the data: every estimate and moment (the pipeline writes this)
site/config.json     labels and cutoffs: verdicts, conviction, axis names (you edit this)
scripts/apply-update.mjs     turns an update note into a data.json change
.github/workflows/publish.yml    applies updates and deploys to GitHub Pages
AGENT_PROMPT.md      instructions for the phone agent
```

## How an update flows

```
you, on your phone             any chat agent              GitHub
"feeling better after     ->   reads you as 52%,      ->   issue opened  ->  Action checks it,
 Seaport, still torn"          range 38-62, and            (one tap)         commits data.json,
                               hands back a link                             redeploys, closes
                                                                             the issue (~1 min)
```

The agent does the interpreting, and the pipeline only checks and applies what it gets. No API keys are involved. Only the repo owner's issues are applied, and anyone else's are ignored.

## One-time setup (about 15 minutes, personal accounts only)

1. **Create the repo.** On your personal GitHub, create a **public** repo (for example `boston`). Upload the contents of this folder, `.github/` included, or push it from a personal machine.
2. **Turn on Pages.** Go to Settings > Pages > Build and deployment, and set Source to **GitHub Actions**.
3. **First deploy.** Go to Actions > Publish forecast > Run workflow. The site goes live at https://chadrans.github.io/boston/.
4. **Set up the agent.** Paste `AGENT_PROMPT.md` into a ChatGPT Project's instructions (or a custom GPT, a Claude Project, or Muse's custom instructions).
5. **Sign in on your phone.** Log in to github.com once in your phone's browser so the publish link opens ready to submit.

## Each update (about 30 seconds)

1. Tell the agent how you're feeling, in plain words.
2. Check its read-back line. Push back if it's off, and it gives you a new link.
3. Tap the link, then tap **Create**.
4. About a minute later the bot comments with what it applied and closes the issue. If something was malformed, it says what and leaves the issue open. Edit the issue to fix it, and it tries again.

## Changing things later

Every change is either a new update (through an issue) or an edit to one file. Any edit pushed to `main`, including from GitHub's web editor (open the file, click the pencil, commit), redeploys in about a minute. Before deploying, the workflow checks that `data.json` and `config.json` still parse, so a typo fails the run and the last good version stays live.

| You want to | Do this |
|---|---|
| Log how you feel | Phone agent, tap the link, Create. |
| Flag a trip or place | Same, with a `moment:` line. Trips can end in the future. |
| Log without the agent | Open an issue titled `Forecast update` with `date:`, `estimate:`, `range:` lines. |
| Log several in one day | Send each one. They keep the order they arrive in. |
| Fix or delete a past update or flag | Edit `site/data.json`. One update per line. |
| Rename a label or move a cutoff | Edit `site/config.json` (below). |
| Change the headline, intro, or "How to read this" text | Edit the text in `site/index.html`. |
| Change how the agent reads you | Edit the instructions in your ChatGPT/Muse project. `AGENT_PROMPT.md` is the master copy, so update it too. |
| Change the design or add a feature | Open the repo in Claude Code on a personal machine, preview locally (below), then push. |

### config.json

```json
"verdictByEstimate": [
  { "from": 0,  "label": "Staying put" },
  { "from": 10, "label": "Long shot" },
  ...
]
```

Each label applies from its `from` value up to the next entry's. `verdictByEstimate` keys off the estimate. `convictionByRangeWidth` keys off ceiling minus floor. You can rename labels, move cutoffs, or add and remove entries. Order doesn't matter, but keep one entry at `from: 0`. `axis` names the top, middle, and bottom of the chart, and `valueCaption` is the line next to the big number.

If you move the conviction cutoffs, also update the width guide in the agent prompt ("settled: 15 to 20 ...") so the agent's idea of "settled" matches the page's.

## Preview locally

```
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000. Opening `index.html` directly won't load `data.json`.

## Privacy

The repo, the issues, and `data.json` are public, but they contain only dates, numbers, and place labels. The page carries `noindex`, so it stays out of search results, and it's reachable only by link. The reasoning lives in your own log and in your chats with the agent, never here.
