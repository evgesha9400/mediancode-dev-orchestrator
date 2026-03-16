# Commit Message Standard

All Median Code repos follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

## Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

## Types

| Type | Description |
|------|-------------|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `refactor` | Code restructuring without changing behavior |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, whitespace) |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks, dependencies, configs |
| `ci` | CI/CD configuration changes |
| `perf` | Performance improvements |
| `build` | Build system or dependency changes |

## Scopes

Scopes are repo-specific. See each repo's CLAUDE.md for available scopes.

## Rules

1. **Subject line**
   - Use imperative mood ("add feature" not "added feature")
   - Start with lowercase letter
   - No trailing period
   - Maximum 72 characters

2. **Body** (optional)
   - Separate from subject with blank line
   - Explain *what* and *why*, not *how*
   - Wrap at 72 characters

3. **Breaking changes**
   - Add `!` after type/scope: `feat(api)!: remove deprecated endpoint`
   - Or add `BREAKING CHANGE:` in footer

4. **Co-authorship**
   - Do NOT include any Co-Authored-By lines

## Examples

```
feat(api): add namespace CRUD endpoints

fix(auth): resolve JWT token expiration handling

refactor(models): simplify validation logic

docs: update commit message standard

feat(api)!: change response envelope structure

BREAKING CHANGE: Response envelope now uses `data` instead of `result` field.
```
