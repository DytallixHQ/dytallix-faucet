#!/usr/bin/env python3

from __future__ import annotations

import json
import pathlib
import urllib.request
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "public-capabilities.json"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def main() -> int:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    statement = manifest["canonicalStatement"]
    faucet = manifest["faucet"]
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    require(statement in readme, "Missing canonical statement in README.md")
    require(str(MANIFEST_PATH.name) in readme, "README.md must reference the local manifest")

    limits = faucet["limits"]
    require(f"`{limits['dgt']} DGT`" in readme, "README DGT limit drifted from manifest")
    require(f"`{limits['drt']} DRT`" in readme, "README DRT limit drifted from manifest")
    require(
        f"`{limits['cooldownSeconds']}` second (`{limits['cooldownMinutes']}` minute) cooldown window" in readme,
        "README cooldown drifted from manifest",
    )
    require(
        f"`{limits['maxRequestsPerHour']}` requests per hour" in readme,
        "README hourly cap drifted from manifest",
    )

    with urllib.request.urlopen(faucet["statusUrl"], timeout=20) as response:
        payload = json.load(response)

    for key in faucet["statusResponse"]["requiredKeys"]:
        require(key in payload, f"Live faucet status missing key: {key}")

    live_limits = payload.get("limits", {})
    require(payload.get("status") == faucet["statusResponse"]["statusValue"], "Live faucet status value drifted")
    require(live_limits.get("dgt") == limits["dgt"], "Live faucet DGT limit drifted")
    require(live_limits.get("drt") == limits["drt"], "Live faucet DRT limit drifted")
    require(live_limits.get("cooldownMinutes") == limits["cooldownMinutes"], "Live faucet cooldown drifted")
    require(live_limits.get("maxRequestsPerHour") == limits["maxRequestsPerHour"], "Live faucet hourly cap drifted")

    return 0


if __name__ == "__main__":
    sys.exit(main())