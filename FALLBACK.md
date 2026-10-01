# Emergency MP lookup fallback

Prepared locally on 1 October 2026. Nothing has been pushed or deployed.

TWFY remains the primary provider. The primary API response fields, client authentication, CORS, curated email override, and getPerson/getMPs recovery are preserved. The current GitHub api/mp.js and emails.json were read through the connected GitHub service and confirmed to match the uploaded ZIP (handler text and parsed email rows).

## New behavior

The primary TWFY request has a three-second timeout covering both fetch and JSON body reading. Network errors, timeouts, malformed JSON, HTTP 5xx, HTTP 429, and an unusable response after existing recovery steps trigger exact local lookup. There is no retry, to keep emergency lookup responsive. Ordinary upstream HTTP 4xx responses and missing API-key errors keep their existing behavior.

Supplementary TWFY calls each have a three-second timeout; curated GitHub email refresh has a two-second timeout. These are per-call limits, not an overall request deadline. Successful existing responses remain unchanged; a valid primary result with a null curated email retains the existing null-email semantics.

Emergency lookup uses only bundled files: normalized full postcode → constituency ID → constituency name → bundled api/data/emails.json row. It makes no further network request. The response uses the existing six fields. Because the curated list has no TWFY person IDs, emergency person_id and contact_url are null. MP names, party and email come from the curated list; no values are guessed. Missing curated email or no exact postcode match returns a controlled 503 error.

No postcodes, credentials, upstream URLs, supporter details or email content are logged. Error output is restricted to outcome categories. Tests use synthetic credentials and mocked requests only.

## Data and known limitations

- 1,788,792 in-use full postcodes, mapped to 648 constituencies.
- Compressed binary: 4,075,177 bytes; decoded buffer: 16,099,128 bytes.
- Name table: 649 names (includes the empty Ladywood source); IDs and name table are generated together.
- Aberafan Maesteg has no file in the archive.
- Birmingham Ladywood contains only 57 postcode districts, with no in-use status. All are excluded. No district-wide guess is made.
- Terminated records are excluded, including historic NPT formats. New postcodes missing from the static source cannot use emergency lookup.
- Seventeen filenames carry an extra -2 suffix. Two Welsh filenames have encoding damage. The generator resolves these and matches every source name to emails.json; no fuzzy matching runs in production.
- Source filenames say 2024; exact source currency is unverified. The bundled MP/email list matches the current repository, but that alone does not independently establish all entries are current.
- During an outage, coverage gaps and constituencies whose curated email is null produce the controlled error. TWFY continues to serve them when available.

Keep api/data/emails.json current and deploy its updates with the lookup code. Normal requests keep the existing ten-minute GitHub refresh; emergency requests intentionally use the deployed snapshot, so editing only GitHub without updating the deployed bundle will not refresh emergency data.

## Files changed or added

Modified: api/mp.js and package.json (test command only).
Added: lib/postcode-fallback.js, lib/postcodes/{lookup.bin.gz,names.json,manifest.json}, scripts/build-postcode-fallback.py, test/mp.test.cjs, vercel.json, FALLBACK.md.
All other supplied repository files are byte-for-byte unchanged. No dependency was added. Sending, tracking, counters, and synchronization workflows were not edited.

vercel.json adds includeFiles only for api/mp.js. It explicitly bundles data files without altering routing, runtimes or durations. Configuration reference: https://vercel.com/docs/project-configuration/vercel-json
The Vercel packaging/build and live website behavior have not been tested because nothing has been deployed. Preserve any newer project configuration when applying this change.

## Validation

Run `npm test` with a Node version that supports node:test, global fetch and AbortController (the existing handler already uses fetch). No dependency installation is required for these tests.

Ten test groups cover authentication/preflight, missing postcode/key, normal primary output and curated override, existing secondary lookups, array normalization, GitHub refresh failure, upstream/network/JSON failures, fetch/body timeouts, preserved 4xx handling, normalized exact matching, filename aliases, coverage exclusions, missing email, unknown input, sampled binary records including boundaries, and corrupt artifacts. All passed locally on Node 24.15.0.

Twelve separate comparisons between the uploaded original handler and the updated handler passed for normal primary results, existing secondary recovery, null curated email entries, and GitHub refresh failures. Status, JSON response and CORS headers matched. These comparisons are evidence for the tested cases, not a guarantee of all possible inputs.

The generator exhaustively decoded all 1,788,792 generated records and checked their postcode and constituency against the input assignments. It rejects duplicate active keys, malformed active postcodes, ambiguous curated names, and unmatched filenames. Runtime loading checks schema, count, length, data and names SHA-256, and the names-to-emails crosswalk before caching the buffer. The lookup file is only loaded on first fallback use.

To rebuild after obtaining a corrected source:

`python3 scripts/build-postcode-fallback.py /path/to/AllPostcodes.zip`

Commit/deploy the generated files together. Do not retain an old names table with a new binary table. Review the manifest's missing/empty constituencies after each rebuild.

## Applying and rollback

The accompanying patch describes code/text changes; the ZIP additionally contains the binary data. Apply only the listed files to a checkout matching the uploaded baseline, rather than replacing unrelated work. Use the current GitHub commit as the baseline and inspect any changes made since this package was prepared.

Before any future production deployment: run tests, confirm that the packaged api/mp function contains the three data files and emails.json, test a preview with the actual site consumers (especially null emergency person_id/contact_url), and check normal lookup plus a simulated outage. This preparation does not authorize or perform deployment.

Rollback is reverting the two modified files and removing the newly added files, followed by deployment through your normal process. The original uploaded ZIP has not been altered.
