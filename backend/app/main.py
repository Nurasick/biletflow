import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.services import storage
from app.services.hold import release_expired_holds
from app.services.notify import deliver_pending

logger = logging.getLogger(__name__)


def _sweep_once() -> int:
    with SessionLocal() as db:
        return release_expired_holds(db)


async def _sweep_holds_forever(interval: int) -> None:
    # Every worker process runs its own loop. That is safe: see the comment
    # in release_expired_holds on why two sweepers never double-release.
    while True:
        try:
            # The session is synchronous, so keep it off the event loop.
            released = await run_in_threadpool(_sweep_once)
            if released:
                logger.info("released %d expired holds", released)
        except Exception:
            # A failed sweep must not kill the loop; the next tick retries.
            logger.exception("hold sweep failed")
        await asyncio.sleep(interval)


def _deliver_once() -> int:
    with SessionLocal() as db:
        return deliver_pending(db)


async def _send_notifications_forever(interval: int) -> None:
    # The outbox worker (docs/data-model/07-platform.md): requests only write
    # a row, and this loop does the slow part, so no checkout waits on SMTP.
    # Safe with several workers: deliver_pending claims each row before sending.
    while True:
        try:
            await run_in_threadpool(_deliver_once)
        except Exception:
            logger.exception("notification delivery failed")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = []
    if settings.HOLD_SWEEP_INTERVAL_SECONDS > 0:
        tasks.append(
            asyncio.create_task(_sweep_holds_forever(settings.HOLD_SWEEP_INTERVAL_SECONDS))
        )
    if settings.NOTIFY_INTERVAL_SECONDS > 0:
        tasks.append(
            asyncio.create_task(_send_notifications_forever(settings.NOTIFY_INTERVAL_SECONDS))
        )
    yield
    for task in tasks:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        lifespan=lifespan,
    )
    if settings.CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[str(o).rstrip("/") for o in settings.CORS_ORIGINS],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    # Uploaded event images. In production a CDN or the object store serves
    # these; mounting them here keeps the demo a single `docker compose up`.
    media = storage.media_root()
    media.mkdir(parents=True, exist_ok=True)
    app.mount(settings.MEDIA_URL_PATH, StaticFiles(directory=media), name="media")
    return app


app = create_app()
