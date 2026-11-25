# Changelog

## 0.19.1

- `proof liskov application execution show APP_ID` now also prints each V5
  job's provenance record: the job, its processor, every key that processor
  published (in full), the acknowledgement's chain coordinates with Acurast
  Hub links, the Liskov placement verdict at the acknowledgement, and how the
  job key is held. Hand these to a customer who wants to check a job's signing
  key without Liskov. The read is optional: when it is unavailable, human
  output is as before. One-shot `--json` keeps `explanation` and `schedule`
  and adds `executions` (the served page, or `null`). `--watch` is unchanged
  (BKLG-20261121-76ub).
- The hidden `application placement-refusals` read also prints processor
  criteria and manager reasons beside country, spread and inbound
  (BKLG-20261122-w4uw).

## 0.19.0

- The package now declares the SPDX identifier `FSL-1.1-ALv2` for the same
  Functional Source License (ADR-0317).
- `proof liskov login` opens the complete login URL on Windows. It used
  `cmd /c start`, which cut the URL at the first `&`, so the Console reported
  the user code as missing; it now uses `rundll32 url.dll,FileProtocolHandler`
  with no shell. macOS and Linux are unchanged.
- `proof liskov organization use <display name>` still selects by exact ID or
  slug only (ADR-0047). When the selector matches one membership's display
  name, the `not_a_member` refusal names that organization's slug and ID
  (human text, and a `suggestion` field in `--json`).
- New `proof liskov application workload-revisions APP` reads the registered
  provider artifact and the desired, staged and serving workload revision
  state Liskov reports for an Application. It sends only GET requests and
  always skips analytics (BKLG-20261013-gfnu).
- `proof liskov application artifact upload --kind native_payload --descriptor
  payload.json` uploads an unencrypted native Cargo payload through the
  server-issued private PUT/finalize plan; the server decides whether it is
  accepted. `application manifest validate --export` validates and exports V8
  native-payload manifests offline. V8 policy publication stays refused
  (`v8_production_registration_not_activated`) (BKLG-20261013-buih).
- The vendored owner policy bundle now refuses `deployment.booking` as
  `unknown_field` in V4 through V8 documents, and publication authority lives
  only in that bundle; V5 remains the only publishable policy version
  (BKLG-20261013-qle8, BKLG-20261115-ns72, BKLG-20261118-ouys).
- Hidden `application placement-plan` and `application placement-refusals`
  reads; placement-refusals prints inbound IPv6 reasons beside country and
  spread (BKLG-20261003-eib8, BKLG-20261003-shu8, BKLG-20261119-4kth).

## 0.18.1

- `proof liskov application artifact upload` sends only the `file` part.
  0.18.0 also sent `pinataOptions`, which PROOF's upload service refuses with
  `LIA4010` ("Upload request includes unexpected non-file fields"), so every
  upload failed after the token was issued.
- `proof liskov application artifact upload` refuses `--encryption-mode
  aes-256-gcm-payload-v1` before any request, sends the Liskov-issued token
  only to a well-formed `https` `/pinning/pinFileToIPFS` URL, and prints the
  pinned-publish next step (BKLG-20261027-r7xe).

## 0.18.0

- `proof liskov application import` prints the server's refusal code, reason and error diagnostics in human output; `--json` adds `serverError` and `diagnostics` while retaining its existing error codes and reason. Help names the V5 create → source-binding → policy publication path because V4 manifest import is closed. Repository binding repair hints now use `application set-repository`.
- `proof liskov application publish` prints each publication preflight error (`<code>: <message> (<pointer>)`) under the blocked line in human output, for `--dry-run` and for a confirmed publish; `--json` output is unchanged. Its help names `application policy publish` for retained V5 manifests.
