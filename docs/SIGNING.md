# macOS Signing and Notarization

The macOS release build uses Electron Builder's Developer ID signing and notarization support.

## Local Build

Install a valid **Developer ID Application** certificate in the macOS login keychain. Electron Builder can auto-discover it, or you can select one explicitly:

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_KEY="/absolute/path/to/AuthKey_KEYID.p8"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="ISSUER_UUID"
npm run dist:mac
```

## GitHub Actions Secrets

Add these repository secrets before publishing a signed macOS release:

- `CSC_LINK`: base64-encoded `.p12` export of the Developer ID Application certificate and private key.
- `CSC_KEY_PASSWORD`: password for the `.p12` file.
- `APPLE_API_KEY_BASE64`: base64-encoded App Store Connect API key `.p8` file.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.

To base64-encode files on macOS:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
base64 -i AuthKey_KEYID.p8 | pbcopy
```

Do not commit certificate files, `.p12` files, `.p8` files, or passwords to the repository.
