# Agent Guidelines

- Use git checkpoints for coherent units of work; run relevant checks first when practical.
- Use short conventional commits: `feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`, `test(scope): ...`, `chore(scope): ...`.
- If git checkpoints or remote sync are requested, proceed with `git add`, `git commit`, and `git push` without asking again.
- Before staging, inspect unexpected changes and exclude unrelated work.
- Never commit secrets. Real keys stay in `.env`; `.env.example` must contain placeholders only.
- Push to `origin/main` when the user asks for remote sync.
