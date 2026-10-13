# Changelog

## Unreleased

- `proof liskov application import` prints the server's refusal code, reason and error diagnostics in human output; `--json` adds `serverError` and `diagnostics` while retaining its existing error codes and reason. Help names the V5 create → source-binding → policy publication path because V4 manifest import is closed. Repository binding repair hints now use `application set-repository`.
- `proof liskov application publish` prints each publication preflight error (`<code>: <message> (<pointer>)`) under the blocked line in human output, for `--dry-run` and for a confirmed publish; `--json` output is unchanged. Its help names `application policy publish` for retained V5 manifests.
