#!/usr/bin/env python3
"""Check the team party-mode override on a clean checkout.

Copies `_bmad/` and the party-mode skill into a temp tree with no user
override, then resolves every room. Run: python3 _bmad/custom/test_party_roster.py
"""

import json
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SKILL_REL = Path(".claude") / "skills" / "bmad-party-mode"
TEAM = REPO / "_bmad" / "custom" / "bmad-party-mode.toml"


class RosterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(REPO / "_bmad", cls.tmp / "_bmad",
                        ignore=shutil.ignore_patterns("*.user.toml", "__pycache__"))
        shutil.copytree(REPO / SKILL_REL, cls.tmp / SKILL_REL)
        cls.skill = cls.tmp / SKILL_REL

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def resolve(self, *extra):
        cmd = [sys.executable, str(self.skill / "scripts" / "resolve_party.py"),
               "--project-root", str(self.tmp), "--skill", str(self.skill), *extra]
        r = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(r.stdout)

    def test_no_user_override_needed(self):
        self.assertEqual(list((self.tmp / "_bmad" / "custom").glob("*.user.toml")), [])

    def test_default_room_is_the_installed_agents(self):
        d = self.resolve()
        self.assertTrue(d["installed_agents_resolved"])
        self.assertEqual(d["active"], "installed")

    def test_every_room_resolves(self):
        groups = [g["id"] for g in self.resolve("--list-groups")["groups"]]
        self.assertGreaterEqual(len(groups), 5)
        for gid in groups:
            with self.subTest(room=gid):
                d = self.resolve("--party", gid)
                self.assertEqual(d.get("unresolved", []), [])
                self.assertTrue(d["members"])

    def test_team_override_only_adds_cast(self):
        wf = tomllib.loads(TEAM.read_text(encoding="utf-8"))["workflow"]
        self.assertEqual(set(wf), {"party_members", "party_groups"})
        codes = [m["code"] for m in wf["party_members"]]
        self.assertEqual(len(codes), len(set(codes)))
        for key in ("name", "icon"):
            values = [m[key] for m in wf["party_members"]]
            self.assertEqual(len(values), len(set(values)), key)


if __name__ == "__main__":
    unittest.main()
