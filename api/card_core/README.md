# lerne-card-core 0.1.0

Canonical source for pure JSON V2 validation, passport validation/merge, the answer
contract, legacy syntax parsing and V2-to-legacy conversion. This is the only
implementation. No database, SRS, progress, config, network, filesystem side effects
or application initialization belongs here. Pydantic is the only dependency.

TMA imports these same sources through `api.card_core.lerne_card_core`; existing
`api.services` paths are module aliases. This keeps the package inside the existing
Vercel `api/` deployment inputs without changing build entries or requirements.
Admin installs the independently built wheel as `lerne_card_core` and pins its
version and source hashes. No sibling checkout is needed at installation/runtime.

Build from the TMA root:

```sh
python -m pip wheel --no-deps --wheel-dir dist/card-core ./api/card_core
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
