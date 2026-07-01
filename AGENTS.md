# Agent Guidelines

## Git Workflow

- Use git checkpoints for meaningful units of work.
- Commit after finishing a coherent change, after tests/checks pass, or before starting a distinct next step.
- Use conventional commit naming such as `feat(scope): summary`, `fix(scope): summary`, `chore(scope): summary`, `docs(scope): summary`, and `test(scope): summary`.
- Keep commit messages short and specific.
- Do not ask for permission before `git add`, `git commit`, or `git push` when the user has explicitly requested git checkpoints or remote updates.
- Never commit secrets. Keep real API keys in `.env`; keep `.env.example` as placeholders only.
- Before committing, run relevant checks and `git diff --check` when practical.
- Before staging, inspect unrelated or unexpected changes and do not include them in the commit.
- Push committed work to `origin/main` when the user asks for remote sync.
