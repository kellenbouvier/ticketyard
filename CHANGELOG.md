# Changelog

All notable changes to this project during the audit/overhaul are logged here.

## Unreleased

### Fixed
- `pnpm-workspace.yaml`: replaced an invalid, half-finished `allowBuilds` entry
  (`esbuild: set this to true or false`) with `allowBuilds: { esbuild: true }`.
  pnpm 11's build-approval mechanism reads `allowBuilds` (not the
  `onlyBuiltDependencies` list further up the file, which is a different,
  already-satisfied setting) — without this, every `pnpm install` failed with
  `ERR_PNPM_IGNORED_BUILDS` and the toolchain could not install esbuild's
  native binary, blocking all builds.
