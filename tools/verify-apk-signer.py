#!/usr/bin/env python3
"""Report (and optionally enforce) which key signed an APK.

Why this exists: `assembleRelease` silently falls back to the Android **debug**
key when `android/key.properties` is missing (see android/app/build.gradle).
The resulting APK installs fine on a clean device, so a debug-signed build looks
healthy in CI and only fails at the worst possible moment: every user who
already installed a release-signed Fontainor gets
INSTALL_FAILED_UPDATE_INCOMPATIBLE and has to uninstall first, losing their
local library and offline downloads.

Usage:
    python3 tools/verify-apk-signer.py app.apk                 # report only
    python3 tools/verify-apk-signer.py app.apk --expect <SHA256>  # enforce
    python3 tools/verify-apk-signer.py app.apk --reject-debug     # forbid debug key

Exit code is non-zero when an enforcement flag is violated, so a release
workflow can refuse to publish an un-upgradable artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
import zipfile

MAGIC = b"APK Sig Block 42"
# APK Signing Block IDs (Android source: ApkSigningBlockUtils).
SCHEME_IDS = {0x7109871A: "v2", 0xF05368C0: "v3"}
DEBUG_SUBJECT_MARKER = "cn=android debug"


def find_signing_block(data: bytes) -> bytes | None:
    """Return the APK Signing Block payload, or None for a v1-only/unsigned APK."""
    eocd = data.rfind(b"PK\x05\x06")
    if eocd < 0:
        return None
    central_dir_offset = struct.unpack_from("<I", data, eocd + 16)[0]
    if data[central_dir_offset - 16 : central_dir_offset] != MAGIC:
        return None
    size_at_end = struct.unpack_from("<Q", data, central_dir_offset - 24)[0]
    start = central_dir_offset - 8 - size_at_end
    if start < 0 or struct.unpack_from("<Q", data, start)[0] != size_at_end:
        return None
    return data[start + 8 : central_dir_offset - 24]


def iter_pairs(block: bytes):
    offset = 0
    while offset + 12 <= len(block):
        length = struct.unpack_from("<Q", block, offset)[0]
        if length < 4 or offset + 8 + length > len(block):
            return
        ident = struct.unpack_from("<I", block, offset + 8)[0]
        yield ident, block[offset + 12 : offset + 8 + length]
        offset += 8 + length


def read_length_prefixed(buf: bytes, offset: int) -> tuple[bytes, int]:
    size = struct.unpack_from("<I", buf, offset)[0]
    return buf[offset + 4 : offset + 4 + size], offset + 4 + size


def signer_certificates(value: bytes) -> list[bytes]:
    """Extract signer certificate DERs from a v2/v3 signature block."""
    certificates: list[bytes] = []
    signers, _ = read_length_prefixed(value, 0)
    offset = 0
    while offset < len(signers):
        signer, offset = read_length_prefixed(signers, offset)
        signed_data, _ = read_length_prefixed(signer, 0)
        # signed_data = digests | certificates | additional-attributes
        _digests, after_digests = read_length_prefixed(signed_data, 0)
        certs_seq, _ = read_length_prefixed(signed_data, after_digests)
        cert_offset = 0
        while cert_offset < len(certs_seq):
            der, cert_offset = read_length_prefixed(certs_seq, cert_offset)
            if der:
                certificates.append(der)
    return certificates


def describe(der: bytes) -> dict[str, str]:
    info = {
        "sha256": hashlib.sha256(der).hexdigest().upper(),
        "sha1": hashlib.sha1(der).hexdigest().upper(),
        "subject": "<unparsed>",
    }
    try:  # cryptography is a dev-only nicety; fingerprints work without it.
        from cryptography import x509

        cert = x509.load_der_x509_certificate(der)
        info["subject"] = cert.subject.rfc4514_string()
        info["valid_to"] = str(cert.not_valid_after_utc.date())
    except Exception:
        pass
    return info


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk")
    parser.add_argument("--expect", help="required signer certificate SHA-256 (hex)")
    parser.add_argument(
        "--reject-debug",
        action="store_true",
        help="fail if the APK is signed with the Android debug key",
    )
    args = parser.parse_args()

    data = open(args.apk, "rb").read()
    with zipfile.ZipFile(args.apk) as archive:
        v1 = [
            name
            for name in archive.namelist()
            if name.upper().startswith("META-INF/")
            and name.upper().endswith((".RSA", ".DSA", ".EC"))
        ]

    block = find_signing_block(data)
    if block is None:
        print(f"::error::{args.apk} has no APK Signing Block (v2/v3) — unsigned or v1-only")
        return 1

    found: list[dict[str, str]] = []
    for ident, value in iter_pairs(block):
        scheme = SCHEME_IDS.get(ident)
        if not scheme:
            continue
        for der in signer_certificates(value):
            info = describe(der)
            info["scheme"] = scheme
            found.append(info)

    if not found:
        print(f"::error::{args.apk}: could not extract any signer certificate")
        return 1

    print(f"APK: {args.apk}")
    print(f"  v1 JAR signature files: {v1 or 'none'}")
    for info in found:
        print(f"  scheme {info['scheme']} signer:")
        print(f"    subject : {info['subject']}")
        print(f"    SHA-256 : {info['sha256']}")
        print(f"    SHA-1   : {info['sha1']}")
        if "valid_to" in info:
            print(f"    expires : {info['valid_to']}")

    status = 0
    is_debug = any(DEBUG_SUBJECT_MARKER in i["subject"].lower() for i in found)
    if args.reject_debug and is_debug:
        print(
            "::error::APK is signed with the Android DEBUG key. It cannot upgrade an "
            "existing release-signed install — users would have to uninstall first "
            "(losing their local library and offline downloads). Configure the four "
            "ANDROID_KEYSTORE_* secrets before publishing."
        )
        status = 1

    if args.expect:
        want = args.expect.replace(":", "").replace(" ", "").upper()
        if not any(i["sha256"] == want for i in found):
            print(
                f"::error::signer mismatch — expected certificate SHA-256 {want}, "
                f"got {', '.join(i['sha256'] for i in found)}. Installing this build "
                "over the published release is impossible; a different key was used."
            )
            status = 1
        else:
            print(f"  ✓ signer matches the expected release certificate ({want[:16]}…)")

    if status == 0 and not args.expect and not args.reject_debug:
        print("  (report only — pass --expect/--reject-debug to enforce)")
    return status


if __name__ == "__main__":
    sys.exit(main())
