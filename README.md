# dae/honk Native API

This repository holds the wire contract for the native HTTP control-plane API
shared by dae and honk, the Linux eBPF transparent-proxy engines. It has two
parts: an OpenAPI 3.1 description of every request, response and event, and
prose documentation of the rules that a schema cannot state. The Hexo site
publishes both.

## Layout

| Path | Contents |
|---|---|
| `api/` | OpenAPI sources, one file per area. `api/openapi.yaml` is the entry point. Edit these. |
| `source/openapi.yaml` | The bundle generated from `api/`. Do not edit it by hand. |
| `source/v0.1.0/en/` | The documentation for contract version 0.1.0. `index.md` is the overview; `docs/` has one page per area. |
| `tools/` | The contract checker, the flow-trace validator and their tests. |
| `scripts/` | Hexo scripts that render API examples and check links during the site build. |

## Build and check

CI uses Node.js 24 and Yarn Classic from `yarn.lock`. The site theme is a git
submodule, so initialise it before building:

```sh
git submodule update --init --recursive
corepack enable
yarn install --frozen-lockfile
yarn check:contract
```

`check:contract` regenerates `source/openapi.yaml` from `api/`, lints it with
Redocly, runs `tools/check-contract.mjs` (flow traces and configuration
examples), and runs the tests in `tools/check-contract.test.mjs`, which validate
every named example against its schema. `yarn build` generates the site into
`public/`; `yarn server` serves it locally.

CI runs the same check and then fails if `source/openapi.yaml` differs from the
regenerated bundle, so commit the bundle together with the source change.

## Proposing a change

1. Branch from `honk`.
2. Change the schema in `api/` and the matching page in `source/v0.1.0/en/docs/`.
   Add or update a named example when the change affects a response shape.
3. Run `yarn check:contract` and commit the regenerated `source/openapi.yaml`.
4. Open a pull request against `honk`. Say what changed on the wire and how
   dae and honk implement it.
