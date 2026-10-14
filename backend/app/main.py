import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import SessionLocal
from app.services.hold import release_expired_holds

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


@asynccontextmanager
async def lifespan(_: FastAPI):
    interval = settings.HOLD_SWEEP_INTERVAL_SECONDS
    sweeper = asyncio.create_task(_sweep_holds_forever(interval)) if interval > 0 else None
    yield
    if sweeper is not None:
        sweeper.cancel()
        with suppress(asyncio.CancelledError):
            await sweeper


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
    return app


app = create_app()
