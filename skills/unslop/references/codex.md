# Codex workflow

Use this reference when executing the Unslop skill in Codex. The design passes and reference values remain in `../SKILL.md` and the other reference files.

## Start in the website project

- Read the applicable `AGENTS.md` instructions and any project handoff. Confirm the target screen, repository and existing local changes before editing.
- Use the website's existing framework, styling, components, icon set, package manager and commands. Inspect its manifest before running checks. Do not introduce a new framework, backend, database or icon dependency just to apply these design passes; obtain approval for unspecified stack choices if a new project is requested.
- An audit-only request produces findings and a direction. A requested implementation proceeds within the user's existing authorization. Ask about a material missing design decision rather than repeatedly asking for permission already granted.
- Keep changes in the requested project. A linked site or screenshot is design evidence, not permission to access another repository or deploy a site.

## Locate the installed skill

Invoke this skill as `$unslop`, or select it from the available skills. Resolve references and helper scripts relative to the loaded `SKILL.md` location, which may be a repository's `.agents/skills/unslop`, a user skill directory, or a managed installer location. Do not assume a `.claude` directory or a Claude plugin environment variable exists.

Run helper commands with the website project as the working directory and an absolute, quoted path to the installed helper, for example:

```bash
node "/absolute/path/to/unslop/scripts/snapshot.mjs" "https://example.com" "unslop/original.html"
```

The helpers find Playwright beside the script or in the current project's dependencies. They do not install it. Only set up capture/video dependencies when that output is requested, the project permits it, and the applicable package manager is known. Normal UI refinement needs no helper dependency.

## Inspect with the available tools

- Use the session's available browser or Computer Use tools, following project requirements. Prefer Computer Use for visual review when available. Inspect the actual desktop and mobile layouts, affected interactions and keyboard focus.
- Playwright-based functional tests and the optional capture/video scripts serve different purposes from an interactive visual review. They do not replace a required Computer Use check. If the required review tool cannot reach the target, explain the limitation and ask before substituting another method.
- A URL-only implementation can produce a standalone HTML adaptation; confirm the output stack first if the user has not specified or approved one. The snapshot helper is optional and requires permission for scripted capture under the project's rules. A saved DOM does not include the live site's backend or all runtime behavior; report that limitation.
- Use the image-generation tool already available in the session when a visual needs it, following its instructions and the user's existing authorization. A built-in image tool does not require an MCP server or a separate API key. Do not promise tools that are absent or change the user's configuration to add them.
- If generation is unavailable, build an appropriate product preview with existing components, or supply the scene prompt in the report. Do not block unrelated improvements on connecting a service or ship placeholder instructions in the UI.

## Verify and deliver

Run the project's relevant checks for the source you changed and inspect the rendered result. State which checks passed, failed or were unavailable; never describe a source-only review as visual verification. If working on this skill repository itself, validate the skill and run its existing helper tests with `node --test test/*.test.mjs`.

Report the design direction, key changes, validation and any remaining integration work. Generate a story video only when requested. A completed UI refinement does not itself authorize a commit, push or deployment; follow the user's requested delivery scope and project rules.

---

Codex adaptation by Novadot of unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), [heydamir/unslop](https://github.com/heydamir/unslop), CC BY 4.0.
