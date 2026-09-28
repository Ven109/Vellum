# Security policy

## Supported versions

Security fixes are released for the latest minor version of Vellum. Self-hosters should keep up to date
with releases.

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Report them privately using GitHub's
[private vulnerability reporting](https://github.com/Ven109/Vellum/security/advisories/new). Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the affected version, platform (web, desktop, self-hosted) and configuration.

We aim to acknowledge reports within 3 working days and to ship a fix or mitigation within 30 days for
high-severity issues. We will credit you in the release notes unless you ask us not to.

## Scope notes

Areas we care about most:

- **API keys.** User-supplied AI provider keys must never be logged, returned to the client after save or
  sent anywhere other than the chosen provider.
- **Document access control.** Sharing roles, links and public links.
- **Desktop app hardening.** Context isolation, preload surface and auto-update integrity.
- **Voice.** Audio must only go to the speech provider the user selected.
