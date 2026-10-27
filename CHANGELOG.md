# Changelog

## 0.18.1

- `proof liskov application artifact upload` sends only the `file` part.
  0.18.0 also sent `pinataOptions`, which PROOF's upload service refuses with
  `LIA4010` ("Upload request includes unexpected non-file fields"), so every
  upload failed after the token was issued.
- `proof liskov application artifact upload` refuses `--encryption-mode
  aes-256-gcm-payload-v1` before any request, sends the Liskov-issued token
  only to a well-formed `https` `/pinning/pinFileToIPFS` URL, and prints the
  pinned-publish next step (BKLG-20261027-r7xe).

## Unreleased

- `proof liskov application import` prints the server's refusal code, reason and error diagnostics in human output; `--json` adds `serverError` and `diagnostics` while retaining its existing error codes and reason. Help names the V5 create → source-binding → policy publication path because V4 manifest import is closed. Repository binding repair hints now use `application set-repository`.
- `proof liskov application publish` prints each publication preflight error (`<code>: <message> (<pointer>)`) under the blocked line in human output, for `--dry-run` and for a confirmed publish; `--json` output is unchanged. Its help names `application policy publish` for retained V5 manifests.
