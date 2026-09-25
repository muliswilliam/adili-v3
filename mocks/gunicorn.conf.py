"""Production server settings; override with GUNICORN_* style env vars if needed."""

import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
workers = int(os.environ.get("GUNICORN_WORKERS", "2"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
accesslog = "-"
errorlog = "-"
