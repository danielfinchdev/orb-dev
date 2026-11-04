# How to request a feature

There are two ways, depending on its size:

- **Something small or a fix:** just say it in the chat. If you mean a specific screen, use its screenshot code
  (for example "on E3 remove the De qué va field"). The codes are in `diseno/capturas/INDICE.md`.
- **A new feature:** a GitHub issue with the **Feature** template: Issues → New issue → Feature.
  One issue per feature; if it is big, split it into several small ones.

Designs (screenshots, mockups, diagrams, animations) are dragged into the issue or saved in
[`diseno/`](diseno/README.md) and linked from it.

## The template

It is the same one GitHub uses (`.github/ISSUE_TEMPLATE/feature.md`). If you change one, change the other too.

```markdown
## What I want
In one or two sentences: what it has to do and what for.

## How it is used
Steps for the person using it: where they click, what they see, what happens.

## What it looks like
Screenshots, mockups, GIFs or videos. An Excalidraw diagram: upload it to docs/diseno/diagramas and link it.

## Definition of done
- [ ] …
- [ ] …

## What not to touch
What must stay the same.

## Screen or part of the app
Chat, Tasks, Conversation, Agents, Settings, Mobile… (see docs/ARCHITECTURE.md)
```

## What to put in each part

- **What I want:** the goal, not the solution. "Use Orb from my phone without installing anything" says more than
  "add a server".
- **How it is used:** the person's path, step by step. That is what gets tested later.
- **What it looks like:** any image helps, even a hand drawing or a screenshot of another app (for example the RustDesk
  card that inspired the update notice).
- **Definition of done:** a checklist. Each item becomes a test.
- **What not to touch:** what has to stay the same (another screen, a behaviour you already like).
- **Screen or part of the app:** where it changes, with its screenshot code if there is one, or the section of
  [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What happens next

1. It is implemented on its own branch and tested (automated tests and, when relevant, in the installed app).
2. A pull request is opened; CI tests it on Windows and Linux.
3. When it is merged with a new version in `package.json`, the release is published and Orb offers the update by itself.
4. [`CHANGELOG.md`](CHANGELOG.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md) are updated in the same change.
