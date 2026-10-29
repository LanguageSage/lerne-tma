# lerne-card-core 0.1.3

Canonical source for pure JSON V2 validation, passport validation/merge, the answer
contract, legacy syntax parsing and V2-to-legacy conversion. This is the only
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

0.1.1 fixes Quiz question/option boundaries: checkbox blocks take precedence over
numbered question statements, labelled answers must form a complete suffix, and
unlabelled legacy answers require a separate final paragraph. Ambiguous blocks
remain plain source text. Correctness markers now preserve bold formatting just
like the JS parser. Storage and card JSON contracts are unchanged. Shared examples
and fallback cases: `local/test-data/fixtures/quiz_boundaries.json` at the TMA root.

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
