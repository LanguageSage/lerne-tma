# lerne-card-core 0.3.0

Canonical source for pure JSON V2 validation, passport validation/merge, the answer
contract, native Codex/JSON V2 import, legacy syntax parsing and V2-to-legacy conversion. This is the only
implementation. No database, SRS, progress, config, network, filesystem side effects
or application initialization belongs here. Pydantic is the only dependency.

TMA imports these same sources through `api.card_core.lerne_card_core`; existing
`api.services` paths are module aliases. This keeps the package inside the existing
Vercel `api/` deployment inputs without changing build entries or requirements.
Admin installs the independently built wheel as `lerne_card_core` and pins its
version and source hashes. No sibling checkout is needed at installation/runtime.

Build from the TMA root with the reviewed build tools:

```sh
python -m pip install setuptools==80.9.0 wheel==0.45.1
python scripts/build_card_core.py --output local/test-data/card-core-release/dist
```

For every change: edit only this source, bump both versions in `pyproject.toml` and
`lerne_card_core/__init__.py`, review/update `provenance.json` source hashes, run the
parser/V2/passport regressions and `scripts/verify_admin_contract.py`. Build the
wheel once; distribute that exact artifact. Admin reviews it in a new directory,
updates `vendor/`, `core/card_core.json`, dependency/constraint pins and tests.
Never overwrite an already released version or modify extracted wheel sources.

The first release moves five AST-identical TMA/Admin modules with only relative
import changes. Provenance records the selected TMA revision and original bytes.
The DB compatibility contract is separate; extraction alone changes no semantics.

## Native V2 client contract

The `ContentV2` envelope and card models in `structured_cards_v2.py` own the
structural constraints and defaults. Model `rules` carry cross-field constraints
into JSON Schema as `x-rules`. The Python and JS evaluators implement the rule
operators, while the declarations live with the Pydantic models.

For a new field, edit its Pydantic model. For a cross-field check, add a rule
using an existing operator. The generator reports custom Pydantic hooks and
schema features that lack a browser equivalent.

```sh
python scripts/generate_native_v2_contract.py
python scripts/generate_native_v2_contract.py --check
python scripts/test_backend.py scripts/tests/test_native_v2_client_contract.py
```

The generated client file is checked into TMA so browser builds are self-contained.
The parity test checks accepted and rejected inputs and normalized defaults. A
separate test changes the minimum number of Trainer gaps in a copy of the source
and regenerates the browser contract.

## 0.3.0 release candidate

Trainer Choice infers the correct answer from a single option when its
`correct` flag is omitted. Multiple options retain their authored flags.
The validator accepts the historical `distractors: "auto"` and `null` fields
and omits them from normalized JSON. The browser uses option count to decide
whether to generate alternatives and falls back to typed input if needed.

Puzzle creation, content edits and author imports require a nonblank
`translation`. TMA reads historical Puzzle records and restores offline
material archives with their original translation text. Before enabling strict
writes in production, use a backup and a read-only inventory to find incomplete
Puzzle cards, then add reviewed translations to those card IDs using normal
revision-checked edits. Verify the inventory again before rollout.

Admin 0.2.0 rejects a one-option choice without the historical flag. Coordinate
the Admin wheel, its pins and fixtures, and the TMA releases before writing
flagless Trainer choices to a shared database. Verify legacy and new cards in
both applications against a disposable database before release.

An APK or TMA source change does not publish a card-core wheel. The reviewed
`source_tree` in provenance identifies the package subtree in Git, independent
of the commit that includes the manifest. The referenced Git revision still
provides the wheel's reproducible timestamp.

0.1.1 fixes Quiz question/option boundaries: checkbox blocks take precedence over
numbered question statements, labelled answers must form a complete suffix, and
unlabelled legacy answers require a separate final paragraph. Ambiguous blocks
remain plain source text. Correctness markers now preserve bold formatting just
like the JS parser. Storage and card JSON contracts are unchanged. Shared examples
and fallback cases: `tests/fixtures/quiz_boundaries.json` at the TMA root.

0.1.2 accepts an explicit `::exercise` containing Quiz options without repeating
the question from `::task` or `::source`. `parse_quiz_options` and the boundary
helper expose an optional `allow_empty_question` flag; existing callers retain
the question requirement by default. Storage and JSON schemas are unchanged.

0.1.3 retains the exact parser/schema logic of 0.1.2 and fixes release
reproducibility. All package Python files, provenance and build inputs use LF.
`source_revision` now identifies the actual 0.1.2 Git baseline; `source_files`
hash those Git blobs, while `files` hash 0.1.3 bytes. The only allowed delta is
the declared version change in `__init__.py`. This describes the source precisely
even before a local release commit; it does not label an uncommitted tree as Git.

`scripts/build_card_core.py` rejects CRLF, missing files and undeclared changes,
checks Git → baseline/version delta → provenance → wheel, embeds the reviewed
provenance in the wheel and checks every RECORD digest/size. It builds offline
with the installed setuptools backend, excludes checkout build/egg-info caches,
sets SOURCE_DATE_EPOCH from the baseline commit and refuses a different artifact
at an existing output path. Use the build helper for release artifacts; direct
pip builds do not embed the external provenance document.

Verify a transferred artifact with `python scripts/build_card_core.py --wheel PATH`.
`scripts/tests/test_shared_card_regressions.py` and the Admin counterpart run the
same synthetic corpus for explicit exercises, numbered conditions, Markdown,
correct answers, JSON V2, save/export/reimport and untouched existing material.
The DB admin contract is deliberately deferred to a separate review.

0.1.4 adds a storage-free native importer and preserves Codex reverse-side notes
on Trainer, Quiz and Match. The release provenance points to the exact reviewed
source commit. Admin wheel distribution is tracked separately from the importer.

0.1.6 retains the auto ChoicePart contract from 07466f4 and adds optional ordered
layout references, plain info text and durable inline image elements. Old V2
remains valid, including pre-existing extension metadata. Codex imports preserve
information on either side of the exercise. Legacy preview rejects composition
it cannot preserve. No V1→V2 converter or answer generation logic changes.
`provenance.json` identifies the exact source commit; the Admin candidate is
reviewed independently under `reviews/native-layout-0.1.6/` in its checkout.

0.1.8 allows `StandardData.answer` to be an empty string (`str = ''`) so standard
cards can be authored without back-side text.
