# Documentation Standard

These principles govern how all documentation in this repository is written and maintained.

1. **Single Source of Truth**: [`api-docs/swagger.json`](../api-docs/swagger.json) is authoritative for all endpoints
2. **No Duplication**: Technical details live in one place; other docs reference them
3. **Layered Complexity**:
   - **Operational**: `docs/` — deployment, configuration, and operations
   - **Interactive**: Runtime API (`/api-docs`, [`api-docs/swagger.json`](../api-docs/swagger.json)) — live exploration
4. **Cross-Referencing**: Docs link to each other and to runtime endpoints
5. **Offline Availability**: All docs are static files (no database lookups required)
6. **Self-Contained Topics**: When treating a subject, keep it self-contained and to the point. Mention things once rather than spreading related information across multiple places in the same document
7. **Positive, Actionable Guidance**: Write instructions as clear actions the reader can execute immediately. Prefer "Do X with Y result" over prohibitions, and use "Avoid X by doing Y" only when risk context is required.
8. **Consistent Terminology**: Keep one terminology lane per document so the guidance remains immediately actionable
9. **Descriptive File Names**: File names define the topic of each document and must be carefully chosen. A file's name should clearly indicate its subject matter without requiring the reader to open it
10. **Complete Indexing**: All documentation files must be referenced at least once in `README.md`. Every document in the codebase should be discoverable through the master index to ensure no documentation is orphaned or forgotten
11. **Meaningful Cross-References**: Documents should reference other files only when the target materially improves reader outcomes. Every cross-reference must be purposeful—removing it should make the document less useful
12. **Generic Then Specific**: When documenting a pattern, convention, or deployment shape that may apply beyond this repository, present it in two steps:
    - **Generic sample first** — placeholders, neutral names, and portable steps (for example `<app-dir>`, `<service>`, `<port>`, “the deployment workflow”).
    - **Specific sample second** — label it clearly (*this repo (SignSanctum)*, *Example (SignPortal)*, or similar) and give the concrete value or path (for example `~/signsanctum-app` vs `~/signportal-app`).

    Use the generic block so readers can adapt the pattern; use the specific block so operators know what this codebase actually does. Do not merge both into one ambiguous list. If a document is only about this repository and has no reusable pattern, a single concrete example is enough—skip the generic layer.

    **Example (deployment path):**

    | Layer | Content |
    | --- | --- |
    | Generic | Deploy application files to `~/<app-dir>/` on the target host. |
    | Specific (*this repo (SignSanctum)*) | `~/signsanctum-app` (see [`cicd-deployment-standard.md`](cicd-deployment-standard.md)). |
    | Example (SignPortal) | `~/signportal-app` |
