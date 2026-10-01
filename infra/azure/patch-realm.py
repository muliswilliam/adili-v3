#!/usr/bin/env python3
"""Point the Keycloak realm file at the public portal and console URLs."""

from __future__ import annotations

import json
import os
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-realm.py <adili-realm.json>")
    path = sys.argv[1]
    portal = os.environ["ADILI_PORTAL_URL"].rstrip("/")
    console = os.environ["ADILI_CONSOLE_URL"].rstrip("/")
    with open(path, encoding="utf-8") as fh:
        realm = json.load(fh)
    # Public HTTP/HTTPS on a raw IP: sslRequired=external 403s browsers.
    realm["sslRequired"] = "none"
    for client in realm.get("clients", []):
        cid = client.get("clientId")
        if cid == "portal":
            client["redirectUris"] = [f"{portal}/*"]
            client["webOrigins"] = [portal]
            client.setdefault("attributes", {})["post.logout.redirect.uris"] = f"{portal}/*"
        if cid == "console":
            client["redirectUris"] = [f"{console}/*"]
            client["webOrigins"] = [console]
            client.setdefault("attributes", {})["post.logout.redirect.uris"] = f"{console}/*"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(realm, fh, indent=2)
        fh.write("\n")
    print(f"Realm redirects: portal={portal} console={console}")


if __name__ == "__main__":
    main()
