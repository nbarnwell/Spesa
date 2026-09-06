# Contributing

This file documents the conventions used in this repository. It applies to everyone working in this codebase, human or AI.

## Before committing

- New functionality or bugfixes should come with unit tests covering the change.
- All unit tests, and any higher-level tests (e.g. integration tests) that don't require manual/user interaction, must pass before a commit is made. Fix failing tests rather than committing around them.
- Pre-commit hooks (if configured) must not be bypassed (no `--no-verify`). If a hook fails, fix the underlying issue.

## Commit messages

- Subject line: imperative present tense, describing what applying the commit does to the codebase — e.g. "Add retry logic to upload handler", not "Added retry logic" or "Adds retry logic".
- Keep the subject line tight and accurate; it's the part that matters most.
- A short body is fine when the change needs more explanation than the subject line alone can give — what changed and why, not a restatement of the diff.
- If this repository has an issue tracker (e.g. a GitHub remote), reference the relevant issue number in the commit message.

## AI-assisted commits

When a commit includes work done by Claude (or another AI assistant), credit it as a co-author using a trailer that names the assistant and the specific model, e.g.:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

If a plan or design for the change was produced by a different model than the one that implemented it, include a separate `Co-Authored-By:` trailer for each.

## Staging and commit granularity

- Only stage and commit the changes that belong to the described change. Unrelated in-progress edits in the working tree should be left alone.
- If it isn't clear whether the working tree's changes belong in one commit or should be split into several, ask rather than guessing.
- If there's nothing to commit, say so — don't create an empty commit.

## General

- Never force-push to `main`/`master`.
- Never amend a commit that's already been pushed, or skip GPG signing, without being explicitly asked to.
- Review staged content before committing; double-check anything that could be a secret (API keys, credentials, `.env` files) before it goes in.
