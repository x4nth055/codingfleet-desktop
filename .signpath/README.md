# SignPath configuration

The Windows builds are signed through [SignPath Foundation](https://signpath.org),
free for open-source projects. `.github/workflows/release.yml` sends the unsigned
files to SignPath and publishes what comes back; nothing is signed on a developer's
computer, and SignPath checks that each file was built by this repository's
workflow on GitHub's own runners.

`artifact-configurations/` holds the two artifact configurations the workflow asks
for, to be created in the SignPath project under the same slugs:

| Slug        | What it signs                                   |
|-------------|-------------------------------------------------|
| `app`       | `CodingFleet.exe`, inside the unpacked app      |
| `installer` | `CodingFleet-Setup-<version>.exe`               |

Both only sign a file whose metadata says product `CodingFleet` at the version being
released, which the workflow passes as the `version` parameter.
