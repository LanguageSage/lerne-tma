---
name: python-refactor
description: Safe refactoring rules for FastAPI endpoints, DB models, and utilities in Lerne TMA.
---

# Python Refactoring Skill (Lerne TMA)

Guidelines for refactoring Python backend code without breaking existing frontend/TMA API contracts.

## Instructions
- **Contract Backward Compatibility**: Never break existing Pydantic request/response JSON schemas consumed by `/app` (Zustand/React).
- **Surgical Edits**: Keep changes minimal and isolated to affected route modules or service helpers.
- **Verification**: Run `python -m py_compile` on touched files and verify FastAPI routing before declaring completion.
- **Deprecation**: If an endpoint parameter is deprecated, keep it optional until frontend sync is completed.
