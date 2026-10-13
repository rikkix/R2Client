# R2 Client (personal modification)

This is an unofficial, unverified modification of the [original R2 Client](https://github.com/dickwu/r2), made for personal use. It is not intended for public distribution or production use. No public support is offered.

Personal changes:

- Remove the macOS menu bar icon.
- Require explicit signed URL generation with a selected lifetime; use authenticated reads for private previews.
- Add file metadata editing, with saves limited to 5 GiB.

Local fixture tests were run, but live R2 and other providers have not been verified. Passing local tests does not establish production readiness. See the [validation record](docs/engineering/personalization-validation.md) for results and remaining limitations.

For the original project and its documentation, refer to upstream.
