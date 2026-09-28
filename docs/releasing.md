# Releasing

1. Update `CHANGELOG.md` and bump the version in `apps/desktop/package.json`.
2. Tag the release: `git tag v1.2.3 && git push origin v1.2.3`.
3. The **Release** workflow then:
   - packages the desktop app on macOS, Windows and Linux, signs it and publishes it to a GitHub release
     (drafts are created by electron-builder and published automatically);
   - uploads `SHA256SUMS.txt` for every asset;
   - builds and pushes the self-hosting server image to `ghcr.io/<owner>/vellum`.

## Signing secrets

| Secret                                                     | Used for                             |
| ---------------------------------------------------------- | ------------------------------------ |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`                     | Developer ID Application certificate |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarisation                         |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Windows Authenticode certificate     |

Linux AppImage, deb and Flatpak builds are not code-signed; users verify them with the published
SHA-256 checksums.

## CI

Every pull request runs lint, format check, typecheck and unit tests, then end-to-end tests and a build
matrix (web on Linux; desktop on macOS, Windows and Linux, unsigned) including the desktop install-size
and cold-start budget check.
