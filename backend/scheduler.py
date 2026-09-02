"""
agraX — Daily ingestion scheduler
Runs inside Railway alongside the API.
Ingests on startup, then every day at 10am ET (when USDA reports are published).
"""

import threading
import time
import logging
from datetime import datetime
import pytz

log = logging.getLogger(__name__)

def run_ingest():
    try:
        log.info("Scheduler: starting price ingestion run...")
        from ingest import run
        run()
        log.info("Scheduler: price ingestion complete.")
    except Exception as e:
        log.error("Scheduler: price ingestion failed: %s", e)

    try:
        log.info("Scheduler: starting movement ingestion run...")
        from ingest_movement import run as run_movement
        run_movement()
        log.info("Scheduler: movement ingestion complete.")
    except Exception as e:
        log.error("Scheduler: movement ingestion failed: %s", e)

def scheduler_loop():
    # Run once immediately on startup to backfill today
    log.info("Scheduler: running startup ingestion...")
    run_ingest()

    ET = pytz.timezone("America/New_York")

    while True:
        now = datetime.now(ET)
        # Target: 10:15am ET daily (USDA publishes by ~10am)
        target_hour = 10
        target_minute = 15

        # Seconds until next 10:15am
        seconds_until = (
            ((target_hour - now.hour) * 60 + (target_minute - now.minute)) * 60
            - now.second
        )
        if seconds_until <= 0:
            seconds_until += 24 * 3600  # already past today's window, wait until tomorrow

        log.info("Scheduler: next ingestion in %.1f hours", seconds_until / 3600)
        time.sleep(seconds_until)
        run_ingest()

def start_scheduler():
    """Start scheduler in a background thread — called from api.py on startup."""
    t = threading.Thread(target=scheduler_loop, daemon=True)
    t.start()
    log.info("Scheduler: background thread started.")
