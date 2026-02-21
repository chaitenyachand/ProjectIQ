"""
main.py
SmartOps / ProjectIQ — Python ML + Agentic AI Backend
FastAPI entry point with startup model loading.
"""

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)

from api.routes import ml, agent, integrations
from api.routes.jira import router as jira_router
from ml.model_registry import ModelRegistry

registry = ModelRegistry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 SmartOps backend starting up...")
    registry.load_all()
    app.state.models = registry
    yield
    logger.info("🛑 SmartOps backend shutting down.")


app = FastAPI(
    title="SmartOps ML & Agentic AI Backend",
    description="ML noise filtering, delay prediction, and agentic BRD generation for ProjectIQ.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your frontend domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ml.router,           prefix="/api/ml",           tags=["ML"])
app.include_router(agent.router,        prefix="/api/agent",        tags=["Agentic AI"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["Integrations"])
app.include_router(jira_router,         prefix="/api/integrations", tags=["Jira"])


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": registry.loaded_model_names(),
    }
