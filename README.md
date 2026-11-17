# unslop

Created by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), who started the [Unslopping series](https://x.com/heydamir/status/2115063463063998736) on X.

![A vibecoded dashboard unslopping itself, frame by frame](skills/unslop/references/refs/story-dashboard-frames.webp)

unslop is a skill for Claude Code, Codex and Google Antigravity that turns vibecoded, AI-looking UI into a designed interface with its own character. It finds the slop first, the purple gradients, glows, emoji labels, shouty copy and uneven spacing, then sets a direction from your product and fixes the screen pass by pass like a designer doing a redline review. It works in whatever your screen is built with, like Next.js, React, Vue, Svelte, Tailwind or plain HTML and CSS, on dashboards, apps and landing pages, and even on a live site when all you have is a link.

This is the [Novadot Codex adaptation](https://github.com/novadot-ORG/unslop/tree/codex-compatibility) of [heydamir/unslop](https://github.com/heydamir/unslop). It adds Codex setup and workflow guidance while keeping the original design references, examples, helper scripts and Claude plugin. This repository distributes a design skill; it is not a website starter or a new application stack.

## Install

### Codex

Ask Codex to install the skill from this fork's compatibility branch:

```text
$skill-installer install https://github.com/novadot-ORG/unslop/tree/codex-compatibility/skills/unslop
```

For a manual install, clone that branch and copy the entire skill folder, including its references, scripts and `agents/openai.yaml`. These commands assume `~/.agents/skills/unslop` does not exist yet; review an existing installation before replacing it:

```bash
git clone --branch codex-compatibility --single-branch https://github.com/novadot-ORG/unslop.git unslop-codex
mkdir -p ~/.agents/skills
cp -R unslop-codex/skills/unslop ~/.agents/skills/unslop
```

If you use the Novadot SSH alias, the equivalent clone URL is `git@github-novadot:novadot-ORG/unslop.git`.

For a team or a single website, copy `unslop-codex/skills/unslop` into `.agents/skills/unslop` at that website's repository root instead. Commit that folder if the team should share it. Do this from the website project, not inside this skill repository. If an `unslop` skill is already installed at the destination, review it before replacing it; do not merge different versions or create duplicate copies with the same name.

Codex discovers repository and user skills from `.agents/skills`; the built-in installer manages its own destination. If the skill does not appear, restart Codex and look for `unslop` in the skill selector. See the [official Codex skill guide](https://learn.chatgpt.com/docs/build-skills) for discovery and installation details.

### Claude Code (original plugin)

For Claude Code, install it as a plugin. Run this in a terminal to get it in every project:

```bash
claude plugin install unslop --marketplace heydamir/unslop
```

On an older Claude Code without `--marketplace`, the same in two steps:

```bash
claude plugin marketplace add heydamir/unslop
claude plugin install unslop@heydamir
```

To get it in a single project only, run the install from that project's root folder, the one you start Claude Code in, and add `--scope local`. To turn it on for everyone who works in the project, add `--scope project` instead and commit `.claude/settings.json`. Each teammate then runs this once in their own copy of the project:

```bash
claude plugin marketplace add heydamir/unslop
claude plugin install unslop@heydamir --scope project
```

Then start a new Claude Code session, or run `/reload-plugins` in one that is already open.

To update, run `claude plugin update unslop@heydamir`, or turn on auto-update for the heydamir marketplace under Marketplaces in `/plugin`.

If you copied unslop into `~/.claude/skills/` or a project's `.claude/skills/` before, delete that copy, or `/unslop` keeps running it instead of the plugin.

These Claude commands install the original upstream release, not this fork's Codex branch.

### Google Antigravity

For Google Antigravity, copy the skill into your skills folder.

```bash
git clone https://github.com/heydamir/unslop
mkdir -p ~/.gemini/config/skills && cp -r unslop/skills/unslop ~/.gemini/config/skills/
```

For a single project, copy it into `.agents/skills/` inside that project instead.

### Optional capture and video tools

The design workflow itself needs no npm package, API key or Claude installation. Use the browser or Computer Use tools available in your Codex session for visual review, following the website project's instructions. If the required tool is unavailable, Codex reports that limitation and asks before substituting another visual-review method.

The optional snapshot and story scripts need Node.js and Playwright. Install Playwright and its Chromium browser only when one of those scripts is needed and dependency changes are authorized in the project where you run it:

```bash
npm install -D playwright
npx playwright install chromium
```

Story videos also require ffmpeg installed and available on your PATH.

The snapshot helper accepts `--width`, `--height` and `--timeout` (milliseconds, default `60000`, range `1000`–`120000`). Viewport dimensions are limited to 8192 pixels each and 33,554,432 pixels in total. Validate a story's metadata without launching a browser or requiring ffmpeg with:

```bash
node skills/unslop/scripts/story.mjs path/to/story.html --check
```

## Helper security and concurrent runs

Snapshots remove active markup and add a policy that blocks scripts, frames, plugins and form submission in the saved page. Capture still opens the original page in a fresh browser context, and saved styles, images and fonts can retain remote resource URLs. This is a visual capture tool, not a general sandbox for hostile web content.

Story HTML and its JavaScript must be trusted. Keep each story and its public assets in a dedicated directory, using relative asset URLs. The preview server binds to loopback, requires a per-run route token, and serves only the selected HTML and supported public asset types. Hidden files, other HTML, directories and unsupported file types are denied. Permitted JavaScript/CSS assets can still contain sensitive data; a route token does not hide them from the story's own scripts. Workspace files must not be mutated by hostile local processes while rendering.

Each video run owns a unique temporary frame directory and cleans it after completion or a handled failure. Different output paths can render concurrently. Writers to the same output are rejected with an `.unslop-lock` error; existing output is replaced only after the new file is ready. Snapshot HTML and PNG publication is atomic per file, not as a pair. A forced kill or power loss may leave a temporary directory or lock: verify that the writer has stopped before removing the named lock and retrying. Input files, symlink outputs and hardlinks to inputs are protected from accidental overwrite.

## Development checks

```bash
node --test test/*.test.mjs
```

The suite includes path/server security, output collision and cleanup, passive snapshot behavior, explicit metadata validation, and concurrent real square/wide video rendering checked with ffprobe. Browser and video integration checks require the optional tools above; inspect the test summary for skipped checks. Automated functional tests do not replace a required Computer Use visual review.

Set `UNSLOP_TEST_ARTIFACT_DIR` to a directory to retain successful square/wide integration videos for visual review. Helper dependencies come from the target project's environment; this repository does not pin or audit that project's complete dependency tree.

## Use

Open your website repository in Codex and mention `$unslop` with the screen or route you want to improve:

```text
$unslop polish the homepage in this repository, keeping our brand and existing stack
$unslop audit the dashboard at http://localhost:3000/dashboard and propose a direction
$unslop redesign this landing page and make a story video of the changes
```

Codex follows the website's `AGENTS.md`, preserves its framework and components, and uses the tools actually available in that session. It edits the website source when available. With only a URL or screenshot, the deliverable is a standalone page for the site's owner to integrate. See the [Codex workflow notes](skills/unslop/references/codex.md).

In Claude Code, type `/unslop` with what you want, or `/unslop:unslop` if another skill already has that name. You can also ask in your own words and let the agent select the skill.

```
/unslop this dashboard
/unslop the hero of https://example.com
/unslop my landing page and make the story video so I can post it
```

It audits the screen and proposes a direction before editing. If you have already approved the direction or asked it to proceed autonomously, it continues within that scope. If the screen is already good, it tells you so and suggests a few small refinements instead of redesigning it.

## What it does

- **Audit.** Lists every sign of slop with where it lives.
- **Direction.** Character, world, the one or two moments that carry the color, and a signature detail, all taken from your product.
- **Passes.** Spacing, color, icons, copy, type, layout, details, visuals and motion, in that order.
- **Visuals.** Shows your product instead of a glossy blob. When a hero needs a scene or an object, it uses an available image tool and follows that tool's authorization requirements. If none is available, it can build a product preview in code and include an image prompt in the report. Dashboards and apps rarely need generated images.
- **Story video.** A square video under 10 seconds of your screen unslopping itself, ready to post. It needs Playwright and ffmpeg.

Try it on the screens in [examples](examples).

## Hire the unslopper

Would rather have a designer do it? Damir unslops one key screen in 3 days, built in your stack, at [heydamir.design/unslop](https://heydamir.design/unslop).

## License

[CC BY 4.0](LICENSE). Use it, change it and share it, including commercially, as long as you credit Damir Sokolovsky ([@heydamir](https://x.com/heydamir)) and link back to the [original repository](https://github.com/heydamir/unslop). Codex compatibility changes in this fork are by Novadot.
