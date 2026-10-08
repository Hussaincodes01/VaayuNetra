"""Sending SMS: through the Pi's 4G/GSM modem via ModemManager, or to a log file in development.

SMS needs no internet, so alerts still go out when the data link is down.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from .config import Config

log = logging.getLogger(__name__)
SMS_PATH = re.compile(r"(/org/freedesktop/ModemManager1/SMS/(\d+))")


class SmsError(Exception):
    pass


class Sender(Protocol):
    def send(self, phone: str, text: str) -> None: ...


class LogSender:
    """Development: append each message to a JSON-lines file instead of sending it."""

    def __init__(self, path: str) -> None:
        self.path = Path(path)

    def send(self, phone: str, text: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": int(time.time()), "to": phone, "text": text},
                               ensure_ascii=False) + "\n")
        log.info("SMS (log only) to %s: %s", phone, text)


class MmcliSender:
    """ModemManager's mmcli: create the message, send it, then delete it from modem storage."""

    def __init__(self, modem: str = "any",
                 run: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
        self.modem = modem
        self.run = run

    def _mmcli(self, *args: str) -> str:
        cmd = ["mmcli", *args]
        try:
            p = self.run(cmd, capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise SmsError(f"mmcli failed: {e}") from e
        if p.returncode != 0:
            raise SmsError(f"mmcli {args[-1]} failed: {(p.stderr or p.stdout).strip()}")
        return p.stdout

    def send(self, phone: str, text: str) -> None:
        # mmcli's key='value' syntax has no escape for quotes: swap them for typographic ones.
        safe = text.replace("'", "’").replace('"', "”")
        create = f"--messaging-create-sms=text='{safe}',number='{phone}'"
        out = self._mmcli("-m", self.modem, create)
        m = SMS_PATH.search(out)
        if m is None:
            raise SmsError(f"mmcli returned no SMS path: {out.strip()[:200]}")
        self._mmcli("-s", m.group(1), "--send")
        try:
            self._mmcli("-m", self.modem, f"--messaging-delete-sms={m.group(2)}")
        except SmsError as e:  # sent already; a full modem store is a later, separate problem
            log.warning("could not delete sent SMS %s: %s", m.group(2), e)


def make_sender(cfg: Config) -> Sender:
    if cfg.sms.backend == "mmcli":
        return MmcliSender(cfg.sms.modem)
    return LogSender(cfg.paths.outbox)
